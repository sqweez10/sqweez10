"use client";

import { useEffect, useState, useCallback, useRef } from "react";
// @ts-ignore
import sdk from "@farcaster/frame-sdk";
// @ts-ignore
import { sdk as miniappSdk } from "@farcaster/miniapp-sdk";
import {
  useAccount, useConnect, useReadContract,
  useWriteContract, useWaitForTransactionReceipt, usePublicClient,
} from "wagmi";
// @ts-ignore
import { farcasterFrame } from "@farcaster/frame-wagmi-connector";
import { formatUnits, parseAbiItem, decodeEventLog } from "viem";
import { base } from "wagmi/chains";

const FAUCET_ADDRESS = (import.meta.env.VITE_FAUCET_ADDRESS ||
  "0x0000000000000000000000000000000000000000") as `0x${string}`;
const APP_URL = import.meta.env.VITE_APP_URL || "https://tysm-faucet.vercel.app";

const FAUCET_ABI = [
  { name: "claim", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { name: "getTimeLeft", type: "function", stateMutability: "view", inputs: [{ name: "_user", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "canClaim", type: "function", stateMutability: "view", inputs: [{ name: "_user", type: "address" }], outputs: [{ type: "bool" }] },
  { name: "faucetBalance", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "userInfo", type: "function", stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "lastClaim", type: "uint256" },
      { name: "streak", type: "uint256" },
      { name: "totalClaimed", type: "uint256" },
      { name: "totalDays", type: "uint256" },
    ]
  },
  { name: "totalClaimsCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "nextReward", type: "function", stateMutability: "view", inputs: [{ name: "_user", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const contractReady = FAUCET_ADDRESS !== ZERO_ADDR;

const TYSM_TOKEN_ADDRESS =
  "0x0358795322c04de04ead2338a803a9d3518a9877" as `0x${string}`;

type ClaimHistoryItem = {
  txHash: `0x${string}`;
  wallet: string;
  claimedDay: number;
  expectedReward: number;
  actualReward?: string;
  createdAt: string;
};

function claimHistoryKey(wallet?: string) {
  return wallet ? `tysm_claim_history_${wallet.toLowerCase()}` : "tysm_claim_history";
}

function loadClaimHistory(wallet?: string): ClaimHistoryItem[] {
  if (typeof window === "undefined") return [];

  try {
    return JSON.parse(localStorage.getItem(claimHistoryKey(wallet)) || "[]");
  } catch {
    return [];
  }
}

function saveClaimHistory(wallet: string | undefined, item: ClaimHistoryItem) {
  if (!wallet || typeof window === "undefined") return;

  const prev = loadClaimHistory(wallet);
  const next = [item, ...prev.filter((x) => x.txHash !== item.txHash)].slice(0, 10);

  localStorage.setItem(claimHistoryKey(wallet), JSON.stringify(next));
}

const REFERRAL_ADDRESS = (import.meta.env.VITE_REFERRAL_CONTRACT_ADDRESS || ZERO_ADDR) as `0x${string}`;
const referralReady = REFERRAL_ADDRESS !== ZERO_ADDR;

const REFERRAL_ABI = [
  { name: "pendingRewards", type: "function", stateMutability: "view",
    inputs: [{ name: "", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "referralCount",  type: "function", stateMutability: "view",
    inputs: [{ name: "", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "claimRewards",   type: "function", stateMutability: "nonpayable",
    inputs: [], outputs: [] },
  { name: "poolBalance",    type: "function", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }] },
  { name: "isReferred",     type: "function", stateMutability: "view",
    inputs: [{ name: "", type: "address" }], outputs: [{ type: "bool" }] },
] as const;

function formatCountdown(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((v) => String(v).padStart(2, "0")).join(":");
}
function nextClaimUTC(secondsLeft: number): string {
  const t = new Date(Date.now() + secondsLeft * 1000);
  const h = String(t.getUTCHours()).padStart(2, "0");
  const m = String(t.getUTCMinutes()).padStart(2, "0");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${t.getUTCDate()} ${months[t.getUTCMonth()]} ${h}:${m} UTC`;
}
function formatAmount(amount: bigint): string {
  return Number(formatUnits(amount, 18)).toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

interface MilestoneEntry { day: number; reward: number; cycleDay: number; }
interface CycleInfo {
  cycle: number;
  cycleDay: number;
  baseRate: number;
  milestones: MilestoneEntry[];
  cycleLabel: string;
}

function getCycleInfo(totalDays: number): CycleInfo {
  if (totalDays <= 30) {
    return {
      cycle: 1, cycleDay: totalDays, baseRate: 2000,
      cycleLabel: "Cycle 1",
      milestones: [
        { day: 7,  reward: 10000,  cycleDay: 7  },
        { day: 15, reward: 40000,  cycleDay: 15 },
        { day: 30, reward: 90000,  cycleDay: 30 },
      ],
    };
  } else if (totalDays <= 60) {
    return {
      cycle: 2, cycleDay: totalDays - 30, baseRate: 2000,
      cycleLabel: "Cycle 2",
      milestones: [
        { day: 37, reward: 20000,  cycleDay: 7  },
        { day: 45, reward: 80000,  cycleDay: 15 },
        { day: 60, reward: 180000, cycleDay: 30 },
      ],
    };
  } else {
    return {
      cycle: 3, cycleDay: totalDays - 60, baseRate: 2000,
      cycleLabel: "Cycle 3+",
      milestones: [
        { day: 67, reward: 20000,  cycleDay: 7  },
        { day: 75, reward: 80000,  cycleDay: 15 },
        { day: 90, reward: 180000, cycleDay: 30 },
      ],
    };
  }
}

function getDailyReward(totalDays: number): number {
  const { milestones, baseRate } = getCycleInfo(totalDays);
  const hit = milestones.find(m => m.day === totalDays);
  return hit ? hit.reward : baseRate;
}

function isMilestoneDay(totalDays: number): boolean {
  const { milestones } = getCycleInfo(totalDays);
  return milestones.some(m => m.day === totalDays);
}

function getNextMilestone(totalDays: number): MilestoneEntry | null {
  const { milestones } = getCycleInfo(totalDays);
  return milestones.find(m => m.day > totalDays) ?? null;
}

function getCycleProgress(totalDays: number): { pos: number; pct: number } {
  const { cycleDay } = getCycleInfo(totalDays);
  const pos = Math.min(cycleDay, 30);
  return { pos, pct: (pos / 30) * 100 };
}

function heartColor(hearts: number): string {
  if (hearts === 0) return "#22c55e";
  if (hearts === 1) return "#eab308";
  if (hearts === 2) return "#f97316";
  return "#ef4444";
}
function heartBg(hearts: number): string {
  if (hearts === 0) return "rgba(34,197,94,0.12)";
  if (hearts === 1) return "rgba(234,179,8,0.12)";
  if (hearts === 2) return "rgba(249,115,22,0.12)";
  return "rgba(239,68,68,0.12)";
}

function getMonthEndSecondsUTC(): number {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return Math.max(0, Math.floor((end.getTime() - now.getTime()) / 1000));
}

interface LeaderboardEntry {
  rank: number;
  address: string;
  handle: string;
  totalDays: number;
  streak: number;
  hearts: number;
}

function HeartBadge({ hearts }: { hearts: number }) {
  const color = heartColor(hearts);
  const bg    = heartBg(hearts);
  const full  = 3 - hearts;
  return (
    <span style={{ color, background: bg, border: `1px solid ${color}40` }}
      className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold">
      {"❤️".repeat(full)}{"🖤".repeat(hearts)} {hearts}/3
    </span>
  );
}

function CycleBadge({ cycle }: { cycle: number }) {
  const colors = ["", "#f59e0b", "#10b981", "#8b5cf6"];
  const c = Math.min(cycle, 3);
  return (
    <span style={{ color: colors[c], border: `1px solid ${colors[c]}50`, background: `${colors[c]}15` }}
      className="text-[9px] font-black rounded-full px-1.5 py-0.5 tracking-widest uppercase">
      C{cycle}
    </span>
  );
}

export default function Home() {
  const [sdkReady, setSdkReady]           = useState(false);
  const [userCtx, setUserCtx]             = useState<any>(null);
  const [countdown, setCountdown]         = useState(0);
  const [justClaimed, setJustClaimed]     = useState(false);
  const [txError, setTxError]             = useState("");
  const [hasShared, setHasShared]         = useState(false);
  const [activeTab, setActiveTab]         = useState<"home" | "board" | "rewards">("home");
  const [monthSecs, setMonthSecs]         = useState(getMonthEndSecondsUTC());
  const [hearts, setHearts]               = useState(0);

  const [liveLeaderboard, setLiveLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [lbLoading,       setLbLoading]       = useState(false);
  const [lbUpdatedAt,     setLbUpdatedAt]     = useState(0);
  const [lbError,         setLbError]         = useState(false);
  const [notifEnabled,    setNotifEnabled]    = useState(false);
  const [copied,          setCopied]          = useState(false);
  const [lbRetryKey,      setLbRetryKey]      = useState(0);
  const [lbPage,          setLbPage]          = useState(1);
  const [refCount,        setRefCount]        = useState<number | null>(null);
  const [refLoading,      setRefLoading]      = useState(false);
  const [refCopied,       setRefCopied]       = useState(false);

    // UX-only: warns if the connected wallet differs from the last wallet seen
    // for this Farcaster FID. Purely informational — never affects claim
    // eligibility, cooldown, or countdown, which always read the on-chain
    // contract with the currently connected wagmi address.
    const [fidWalletMismatch, setFidWalletMismatch] = useState<string | null>(null);

  const [claimHistory, setClaimHistory] = useState<ClaimHistoryItem[]>([]);
  const [lastClaim, setLastClaim] = useState<ClaimHistoryItem | null>(null);
  const processedClaimTxRef = useRef<`0x${string}` | null>(null);

  const { address, isConnected } = useAccount();

  useEffect(() => {
    if (!address) return;
    setClaimHistory(loadClaimHistory(address));
  }, [address]);

  const { connect } = useConnect();
  const publicClient = usePublicClient();
  const baseQ = { query: { enabled: contractReady && !!address } };

  const { data: canClaimData,  refetch: refetchCanClaim  } = useReadContract({
    address: FAUCET_ADDRESS, abi: FAUCET_ABI, functionName: "canClaim",
    args: [address!], ...baseQ,
  });
  const { data: timeLeftData,  refetch: refetchTimeLeft  } = useReadContract({
    address: FAUCET_ADDRESS, abi: FAUCET_ABI, functionName: "getTimeLeft",
    args: [address!], ...baseQ,
  });
  const { data: userInfoData,  refetch: refetchUserInfo  } = useReadContract({
    address: FAUCET_ADDRESS, abi: FAUCET_ABI, functionName: "userInfo",
    args: [address!], ...baseQ,
  });
  const { data: faucetBalData, refetch: refetchBalance   } = useReadContract({
    address: FAUCET_ADDRESS, abi: FAUCET_ABI, functionName: "faucetBalance",
    query: { enabled: contractReady },
  });
  const { data: totalClaimsData } = useReadContract({
    address: FAUCET_ADDRESS, abi: FAUCET_ABI, functionName: "totalClaimsCount",
    query: { enabled: contractReady },
  });

  const { writeContract, data: txHash, isPending: isWritePending, error: writeError } = useWriteContract();
  const {
    data: txReceipt,
    isLoading: isTxLoading,
    isSuccess: isTxSuccess,
  } = useWaitForTransactionReceipt({ hash: txHash });

  const refBaseQ = { query: { enabled: referralReady && !!address } };
  const { data: pendingRefData, refetch: refetchPendingRef } = useReadContract({
    address: REFERRAL_ADDRESS, abi: REFERRAL_ABI, functionName: "pendingRewards",
    args: [address!], ...refBaseQ,
  });
  const { writeContract: writeRefClaim, data: refClaimHash, isPending: isRefClaimPending } = useWriteContract();
  const { isLoading: isRefClaimLoading, isSuccess: isRefClaimSuccess } = useWaitForTransactionReceipt({ hash: refClaimHash });

  useEffect(() => { if (isRefClaimSuccess) refetchPendingRef(); }, [isRefClaimSuccess, refetchPendingRef]);

  useEffect(() => {
    const load = async () => {
      try {
        const ctx = await sdk.context;
        setUserCtx(ctx);
        connect({ connector: farcasterFrame() });
        await miniappSdk.actions.ready();
      } catch (e) {
        console.warn("SDK:", e);
      } finally {
        setSdkReady(true);
      }
    };
    if (!sdkReady) load();
  }, [sdkReady, connect]);

  useEffect(() => {
    if (timeLeftData !== undefined) setCountdown(Number(timeLeftData));
  }, [timeLeftData]);

  useEffect(() => {
    if (countdown <= 0) return;
    const id = setInterval(() => {
      setCountdown((p) => {
        if (p <= 1) { refetchCanClaim(); refetchTimeLeft(); return 0; }
        return p - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [countdown, refetchCanClaim, refetchTimeLeft]);

  useEffect(() => {
    const id = setInterval(() => setMonthSecs(getMonthEndSecondsUTC()), 1000);
    return () => clearInterval(id);
  }, []);

  const totalDays    = userInfoData ? Number(userInfoData[3]) : 0;
  const totalClaimed = userInfoData ? userInfoData[2] : BigInt(0);
  const faucetBal    = faucetBalData ?? BigInt(0);
  const canClaim     = canClaimData ?? false;
  const isBusy         = isWritePending || isTxLoading;
  const globalClaims   = totalClaimsData ? Number(totalClaimsData) : 0;
  const faucetLow = contractReady && faucetBal > 0n && faucetBal < BigInt("100000000000000000000000"); // 100,000 TYSM

  const nextTotalDay  = totalDays + 1;
  const cycleInfo     = getCycleInfo(nextTotalDay);
  const rewardAmt     = getDailyReward(nextTotalDay);
  const isOnMile      = isMilestoneDay(nextTotalDay);
  const nextM         = getNextMilestone(totalDays);
  const { pos: cyclePos, pct: cyclePct } = getCycleProgress(totalDays);

  useEffect(() => {
    if (!isTxSuccess || !txHash) return;
    if (processedClaimTxRef.current === txHash) return;

    processedClaimTxRef.current = txHash;

    setJustClaimed(true);
    setHasShared(false);

    let actualReward: string | undefined;

    try {
      const transferEvent = parseAbiItem(
        "event Transfer(address indexed from, address indexed to, uint256 value)"
      );

      const transferLog = txReceipt?.logs.find((log) => {
        if (log.address.toLowerCase() !== TYSM_TOKEN_ADDRESS.toLowerCase()) return false;

        try {
          const decoded = decodeEventLog({
            abi: [transferEvent],
            data: log.data,
            topics: log.topics,
          });

          const from = String(decoded.args.from).toLowerCase();
          const to = String(decoded.args.to).toLowerCase();

          return (
            from === FAUCET_ADDRESS.toLowerCase() &&
            !!address &&
            to === address.toLowerCase()
          );
        } catch {
          return false;
        }
      });

      if (transferLog) {
        const decoded = decodeEventLog({
          abi: [transferEvent],
          data: transferLog.data,
          topics: transferLog.topics,
        });

        actualReward = formatUnits(decoded.args.value as bigint, 18);
      }
    } catch {
      actualReward = undefined;
    }

    const item: ClaimHistoryItem = {
      txHash,
      wallet: address || "",
      claimedDay: nextTotalDay,
      expectedReward: rewardAmt,
      actualReward,
      createdAt: new Date().toISOString(),
    };

    setLastClaim(item);

    if (address) {
      saveClaimHistory(address, item);
      setClaimHistory(loadClaimHistory(address));
    }

    refetchCanClaim();
    refetchTimeLeft();
    refetchUserInfo();
    refetchBalance();
  }, [
    isTxSuccess,
    txHash,
    txReceipt,
    address,
    nextTotalDay,
    rewardAmt,
    refetchCanClaim,
    refetchTimeLeft,
    refetchUserInfo,
    refetchBalance,
  ]);

  useEffect(() => {
    if (!writeError) return;
    setTxError("Transaction failed. Try again.");
    const id = setTimeout(() => setTxError(""), 4000);
    return () => clearTimeout(id);
  }, [writeError]);

  useEffect(() => {
    if (activeTab !== "board") return;
    let cancelled = false;
    const fetchLb = async () => {
      if (!contractReady || !publicClient) return;
      try {
        setLbError(false);
        setLbLoading(true);
        const bsRes = await fetch(
          `https://base.blockscout.com/api/v2/addresses/${FAUCET_ADDRESS}/transactions?filter=to`,
          { headers: { Accept: "application/json" } }
        );
        const bsJson = await bsRes.json() as {
          items?: Array<{ from: { hash: string }; status: string }>;
        };
        const addresses: `0x${string}`[] = [];
        if (Array.isArray(bsJson.items)) {
          const seen = new Set<string>();
          for (const tx of bsJson.items) {
            const from = tx.from?.hash?.toLowerCase();
            if (from && tx.status === "ok" && !seen.has(from)) {
              seen.add(from);
              addresses.push(tx.from.hash as `0x${string}`);
              if (addresses.length >= 100) break;
            }
          }
        }
        if (addresses.length === 0) {
          if (!cancelled) { setLiveLeaderboard([]); setLbUpdatedAt(Date.now()); }
          return;
        }
        const calls = addresses.map((addr) => ({
          address: FAUCET_ADDRESS,
          abi: FAUCET_ABI,
          functionName: "userInfo" as const,
          args: [addr] as const,
        }));
        const results = await publicClient.multicall({ contracts: calls, allowFailure: true });
        const rawBoard = results
          .map((r, i) => {
            if (r.status !== "success") return null;
            const [, streak, , totalDays] = r.result as readonly [bigint, bigint, bigint, bigint];
            const td = Number(totalDays);
            if (td === 0) return null;
            const addr = addresses[i];
            return { address: addr, handle: `${addr.slice(0, 6)}...${addr.slice(-4)}`, totalDays: td, streak: Number(streak), hearts: 0 };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null)
          .sort((a, b) => b.totalDays - a.totalDays)
          .slice(0, 100)
          .map((e, i) => ({ ...e, rank: i + 1 }));

        const resolveUsers = async (entries: typeof rawBoard): Promise<LeaderboardEntry[]> => {
          try {
            const addressesParam = entries.map((e) => e.address).join(",");
            const res = await fetch(`/api/resolve-users?addresses=${encodeURIComponent(addressesParam)}`);
            if (!res.ok) return entries.map((e) => ({ ...e, handle: `${e.address.slice(0, 6)}...${e.address.slice(-4)}` }));
            const json = await res.json();
            const usersByAddress = json?.users || {};
            return entries.map((e) => {
              const key = e.address.toLowerCase();
              const user = usersByAddress[key];
              return { ...e, handle: user?.handle || `${e.address.slice(0, 6)}...${e.address.slice(-4)}` };
            });
          } catch {
            return entries.map((e) => ({ ...e, handle: `${e.address.slice(0, 6)}...${e.address.slice(-4)}` }));
          }
        };

        const board: LeaderboardEntry[] = await resolveUsers(rawBoard);

        if (!cancelled) { setLiveLeaderboard(board); setLbUpdatedAt(Date.now()); setLbPage(1); }
      } catch {
        if (!cancelled) setLbError(true);
      } finally {
        if (!cancelled) setLbLoading(false);
      }
    };
    fetchLb();
    const intervalId = setInterval(fetchLb, 15 * 60 * 1000);
    return () => { cancelled = true; clearInterval(intervalId); };
  }, [activeTab, publicClient, lbRetryKey]);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get("ref");
      if (ref && /^0x[a-fA-F0-9]{40}$/.test(ref)) {
        localStorage.setItem("tysm_ref", ref.toLowerCase());
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!address) return;
    try {
      const referrer = localStorage.getItem("tysm_ref");
      if (!referrer || referrer === address.toLowerCase()) return;
      if (!/^0x[a-fA-F0-9]{40}$/.test(referrer)) {
        localStorage.removeItem("tysm_ref");
        return;
      }
      fetch("/api/referral-track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referrer, referee: address.toLowerCase() }),
      })
        .then(async (r) => {
          if (r.ok) localStorage.removeItem("tysm_ref");
        })
        .catch(() => { /* keep localStorage so it retries on next mount */ });
    } catch { /* ignore */ }
  }, [address]);

  useEffect(() => {
    if (activeTab !== "rewards" || !address) return;
    setRefLoading(true);
    fetch(`/api/referral-stats?address=${encodeURIComponent(address.toLowerCase())}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setRefCount(d.count); })
      .catch(() => {})
      .finally(() => setRefLoading(false));
  }, [activeTab, address]);

  const myRank         = address ? liveLeaderboard.find(e => e.address.toLowerCase() === address.toLowerCase())?.rank : undefined;

  const mDays = Math.floor(monthSecs / 86400);
  const mHrs  = Math.floor((monthSecs % 86400) / 3600);
  const mMins = Math.floor((monthSecs % 3600) / 60);
  const mSecs = monthSecs % 60;

  const handleShareFirst = useCallback(async () => {
    const name   = userCtx?.user?.displayName || userCtx?.user?.username || "Someone";
    const reward = fmt(rewardAmt);
    const text   = nextM
      ? `Claiming ${reward} $TYSM on Day ${nextTotalDay}!\nOnly ${nextM.day - totalDays} days until Day ${nextM.day} milestone → ${fmt(nextM.reward)} $TYSM!\n\nClaim yours free every 24h:\n\n@tops87sqweezz.base.eth`
      : `${name} is claiming $TYSM on Day ${nextTotalDay}! Free to claim every 24 hours:\n\n@tops87sqweezz.base.eth`;
    const shareUrl = `${APP_URL}/share?user=${encodeURIComponent(name)}&streak=${totalDays}`;
    try {
      await miniappSdk.actions.composeCast({ text, embeds: [shareUrl] });
    } catch {
      const url = `https://farcaster.xyz/~/compose?text=${encodeURIComponent(text)}&embeds[]=${encodeURIComponent(shareUrl)}`;
      await sdk.actions.openUrl(url);
    }
    setHasShared(true);
  }, [userCtx, rewardAmt, nextTotalDay, nextM, totalDays]);

  const handleShareAfter = useCallback(async () => {
    const name   = userCtx?.user?.displayName || userCtx?.user?.username || "Someone";
    const reward = fmt(rewardAmt);
    const text   = isOnMile
      ? `${name} hit Day ${totalDays} Milestone! Received ${reward} $TYSM! 🎁\n\nClaim yours free every 24h:\n\n@tops87sqweezz.base.eth`
      : `${name} claimed ${reward} $TYSM! Day ${totalDays} streak! 🔥\n\nClaim yours free every 24h:\n\n@tops87sqweezz.base.eth`;
    const shareUrl = `${APP_URL}/share?user=${encodeURIComponent(name)}&streak=${totalDays}`;
    try {
      await miniappSdk.actions.composeCast({ text, embeds: [shareUrl] });
    } catch {
      const url = `https://farcaster.xyz/~/compose?text=${encodeURIComponent(text)}&embeds[]=${encodeURIComponent(shareUrl)}`;
      await sdk.actions.openUrl(url);
    }
  }, [userCtx, rewardAmt, totalDays, isOnMile]);

  const handleClaim = useCallback(() => {
    setTxError("");
    
    const builderCapabilities = {
      dataSuffix: {
        value: "0x62635f7034696b386d38620b0080218021802180218021802180218021" as `0x${string}`,
        optional: true
      }
    };

    try {
      if (typeof writeContract === 'function') {
        writeContract({
          address: FAUCET_ADDRESS,
          abi: FAUCET_ABI,
          functionName: "claim",
          chainId: base.id,
          ...({ capabilities: builderCapabilities } as any)
        });
      }
    } catch (err) {
      console.error("Claim error:", err);
      setTxError("Transaction failed. Please try again.");
    }
  }, [writeContract]);

  const handleEnableNotif = useCallback(async () => {
    try {
      await miniappSdk.actions.addFrame();
      setNotifEnabled(true);
    } catch { /* not in miniapp context */ }
  }, []);

  const handleCopyReferral = useCallback(() => {
    const link = address ? `${APP_URL}?ref=${address}` : APP_URL;
    navigator.clipboard.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [address]);

  const handleCopyRefLink = useCallback(() => {
    const link = address ? `${APP_URL}?ref=${address}` : APP_URL;
    navigator.clipboard.writeText(link).catch(() => {});
    setRefCopied(true);
    setTimeout(() => setRefCopied(false), 2500);
  }, [address]);

    // UX-only: FID <-> wallet helper mapping. Never used for claim eligibility,
    // cooldown, or countdown — those always come from the contract reads above,
    // keyed by the currently connected wagmi `address`. This effect only:
    //   1) looks up the last wallet seen for this FID, to show an informational
    //      banner if it differs from the wallet connected right now
    //   2) records the current (fid, wallet) pair for next time
    // Any failure here (network, Redis down) is swallowed silently — the app
    // must keep working normally regardless.
    useEffect(() => {
      const fid = userCtx?.user?.fid;
      if (!address || !fid || !Number.isInteger(fid) || fid <= 0) {
        setFidWalletMismatch(null);
        return;
      }

      const currentWallet = address.toLowerCase();
      let cancelled = false;

      fetch(`/api/fid-wallet?fid=${encodeURIComponent(fid)}`)
        .then(r => (r.ok ? r.json() : null))
        .then((d: { wallet?: string | null } | null) => {
          if (cancelled || !d) return;
          const lastWallet = d.wallet ? d.wallet.toLowerCase() : null;
          if (lastWallet && lastWallet !== currentWallet) {
            setFidWalletMismatch(lastWallet);
          } else {
            setFidWalletMismatch(null);
          }
        })
        .catch(() => { /* fail soft — never block the UI */ })
        .finally(() => {
          // Best-effort: record current pairing. Only fires once we have a
          // valid fid AND a valid connected address (constraint #8).
          fetch("/api/fid-wallet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fid, wallet: currentWallet }),
          }).catch(() => { /* fail soft */ });
        });

      return () => { cancelled = true; };
    }, [address, userCtx?.user?.fid]);

  if (!sdkReady) {
    return (
      <div className="min-h-screen bg-[#0d0d1a] flex flex-col items-center justify-center gap-4">
        <div className="text-6xl animate-bounce">🙏</div>
        <p className="text-yellow-400 text-sm animate-pulse tracking-widest">LOADING TYSM FAUCET...</p>
      </div>
    );
  }

  const { milestones: currentMilestones } = getCycleInfo(Math.max(totalDays, 1));
  const milestoneMarkers = [
    { pct: (7  / 30) * 100, color: "#f59e0b", label: "D7"  },
    { pct: (15 / 30) * 100, color: "#10b981", label: "D15" },
    { pct: (30 / 30) * 100, color: "#8b5cf6", label: "D30" },
  ];

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#0a0a18] via-[#0f1425] to-[#0a0a18] text-white">
      <style>{`
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
        @keyframes milePulse{0%{transform:scale(1)}50%{transform:scale(1.06)}100%{transform:scale(1)}}
        @keyframes shimmer{0%{background-position:200% center}100%{background-position:-200% center}}
        @keyframes glow{0%,100%{opacity:.6}50%{opacity:1}}
        .mile-pulse{animation:milePulse 1.5s ease-in-out infinite}
        .shimmer-text{background:linear-gradient(90deg,#fcd34d,#f59e0b,#fde68a,#f59e0b,#fcd34d);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;animation:shimmer 3s linear infinite}
        .tab-active{border-bottom:2px solid #f59e0b;color:#fcd34d}
        .tab-inactive{border-bottom:2px solid transparent;color:#6b7280}
        .prize-gold{background:linear-gradient(135deg,#92400e,#78350f);border:1px solid #f59e0b60}
        .prize-silver{background:linear-gradient(135deg,#1f2937,#111827);border:1px solid #9ca3af60}
        .prize-bronze{background:linear-gradient(135deg,#1c1009,#0f0a04);border:1px solid #d9770660}
        .lucky-bg{background:radial-gradient(ellipse at top,#1a1040,#0a0a18)}
        .leaderboard-me{background:linear-gradient(90deg,rgba(245,158,11,0.08),rgba(245,158,11,0.04));border-top:1px solid rgba(245,158,11,0.25)}
      `}</style>

      <div className="sticky top-0 z-50 bg-[#0a0a18]/95 backdrop-blur-sm border-b border-white/5">
        <div className="max-w-sm mx-auto flex">
          {(["home", "board", "rewards"] as const).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex-1 py-3 text-xs font-black tracking-widest uppercase transition-all ${activeTab === tab ? "tab-active" : "tab-inactive"}`}>
              {tab === "home" ? "🙏 Claim" : tab === "board" ? "🏆 Board" : "🎁 Rewards"}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "home" && (
        <div className="max-w-sm mx-auto px-4 pt-5 pb-8 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {userCtx?.user?.pfpUrl ? (
                <img src={userCtx.user.pfpUrl} alt="pfp"
                  className="w-10 h-10 rounded-full border-2 border-yellow-500/40 object-cover" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-yellow-900/20 border-2 border-yellow-700/30 flex items-center justify-center text-xl">🙏</div>
              )}
              <div>
                <p className="text-yellow-300 font-bold text-sm leading-tight">
                  {userCtx?.user?.displayName || userCtx?.user?.username || "Farcaster User"}
                </p>
                <p className="text-gray-600 text-[11px]">
                  {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Connecting..."}
                </p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="bg-white/5 border border-yellow-800/30 rounded-xl px-3 py-1 text-right">
                <p className="text-gray-500 text-[9px] uppercase tracking-widest">Total Days</p>
                <p className="text-yellow-400 font-black text-lg leading-tight">{totalDays}d 🔥</p>
              </div>
              <HeartBadge hearts={hearts} />
            </div>
          </div>

            {/* Informational only — never affects claim eligibility/cooldown/countdown */}
            {fidWalletMismatch && (
              <div className="bg-amber-900/20 border border-amber-700/30 rounded-xl px-3 py-2 flex items-start gap-2">
                <span className="text-sm leading-none mt-0.5">⚠️</span>
                <p className="text-amber-300/90 text-[10.5px] leading-snug">
                  You previously connected a different wallet ({fidWalletMismatch.slice(0, 6)}...{fidWalletMismatch.slice(-4)}).
                  Streak and cooldown always follow the wallet you're connected with now.
                </p>
              </div>
            )}

          <div className="text-center py-1">
            <div className="text-5xl mb-1" style={{ animation: "float 3s ease-in-out infinite" }}>🙏</div>
            <h1 className="text-5xl font-black leading-none mb-0.5 shimmer-text">$TYSM</h1>
            <p className="text-gray-500 text-[10px] tracking-[0.4em] uppercase">Daily Faucet · by tops87</p>
          </div>

          <div className="flex items-center justify-center gap-2">
            <CycleBadge cycle={cycleInfo.cycle} />
            <p className="text-gray-500 text-[11px]">
              {cycleInfo.cycle === 1 ? "Base: 2,000 $TYSM/day"
              : cycleInfo.cycle === 2 ? "Cycle 2: Daily 2,000 + bigger milestone bonuses"
              : "Cycle 3+: Daily 2,000 + elite milestone bonuses"}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white/4 border border-yellow-900/20 rounded-2xl p-3">
              <p className="text-gray-500 text-[9px] uppercase tracking-widest mb-0.5">Faucet Pool</p>
              <p className="text-yellow-400 font-black text-base leading-tight">
                {contractReady ? formatAmount(faucetBal) : "—"}
              </p>
              <p className="text-gray-600 text-[10px]">$TYSM left</p>
            </div>
            <div className="bg-white/4 border border-green-900/20 rounded-2xl p-3">
              <p className="text-gray-500 text-[9px] uppercase tracking-widest mb-0.5">You Claimed</p>
              <p className="text-green-400 font-black text-base leading-tight">
                {totalClaimed > BigInt(0) ? formatAmount(totalClaimed) : "0"}
              </p>
              <p className="text-gray-600 text-[10px]">$TYSM total</p>
            </div>
          </div>

          <div className="flex items-center justify-between bg-white/4 border border-white/8 rounded-xl px-4 py-2">
            <span className="text-gray-500 text-[10px]">🌍 Total Global Claims</span>
            <span className="text-yellow-400 font-black text-sm">
              {globalClaims > 0 ? globalClaims.toLocaleString() : "—"}
            </span>
          </div>
          {faucetLow && (
            <div className="flex items-center gap-2 bg-red-950/40 border border-red-700/40 rounded-xl px-3 py-2.5">
              <span className="text-lg">⚠️</span>
              <p className="text-red-300 text-[11px] font-semibold leading-snug">
                Faucet pool is running low — refill coming soon!
              </p>
            </div>
          )}

          <div className="bg-white/4 border border-yellow-900/20 rounded-2xl p-3.5">
            <div className="flex justify-between items-center mb-2">
              <p className="text-gray-400 text-xs font-medium">
                {cycleInfo.cycleLabel} Progress
              </p>
              <p className="text-yellow-400 text-xs font-black">Day {cyclePos}/30</p>
            </div>
            <div className="relative w-full bg-gray-800/80 rounded-full h-3 overflow-hidden mb-1">
              <div className="h-3 rounded-full transition-all duration-700"
                style={{ width: `${cyclePct}%`, background: "linear-gradient(90deg,#f59e0b,#fcd34d)" }} />
              {milestoneMarkers.map((m) => (
                <div key={m.pct} className="absolute top-0 h-full w-0.5"
                  style={{ left: `${m.pct}%`, background: m.color + "60" }} />
              ))}
            </div>
            <div className="flex justify-between mt-1.5">
              {currentMilestones.map((m) => (
                <div key={m.day} className="text-center">
                  <p className="text-[10px]" style={{ color: totalDays >= m.day ? "#f59e0b" : "#4b5563" }}>🎁</p>
                  <p className="text-[8px] text-gray-600">D{m.day}</p>
                  <p className="text-[8px] font-bold" style={{ color: totalDays >= m.day ? "#f59e0b" : "#4b5563" }}>
                    {fmt(m.reward)}
                  </p>
                </div>
              ))}
            </div>
            {nextM && (
              <div className="mt-2.5 bg-white/5 border border-yellow-800/20 rounded-xl px-3 py-1.5 flex justify-between items-center">
                <p className="text-gray-500 text-[10px]">Next Milestone</p>
                <p className="text-yellow-400 text-[10px] font-bold">
                  🎁 Day {nextM.day} → {fmt(nextM.reward)} $TYSM ({nextM.day - totalDays}d left)
                </p>
              </div>
            )}
          </div>

          <div className="bg-white/4 border border-yellow-900/20 rounded-2xl p-4 text-center"
            style={{ boxShadow: isOnMile ? "0 0 32px rgba(245,158,11,0.28)" : "0 0 20px rgba(245,158,11,0.08)" }}>
            {!contractReady ? (
              <p className="text-gray-600 text-sm py-4">Deploy contract first...</p>
            ) : canClaim ? (
              <>
                {isOnMile ? (
                  <div className="mile-pulse inline-flex items-center gap-1.5 bg-yellow-950/60 border border-yellow-500/40 rounded-full px-3 py-1 mb-2.5">
                    <span>🎁</span>
                    <p className="text-yellow-300 text-[11px] font-black">MILESTONE DAY!</p>
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-1.5 bg-green-950/60 border border-green-700/30 rounded-full px-3 py-1 mb-2.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                    <p className="text-green-400 text-[11px] font-bold">READY TO CLAIM</p>
                  </div>
                )}
                <p className="font-black text-yellow-400 leading-none mb-0.5" style={{ fontSize: 48 }}>
                  {fmt(rewardAmt)}
                </p>
                <p className="text-gray-500 text-sm mb-3">$TYSM tokens</p>
                {txError && (
                  <p className="text-red-400 text-xs mb-2 bg-red-950/30 rounded-lg p-1.5">{txError}</p>
                )}
                {isTxSuccess && justClaimed && lastClaim && (
                  <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-200 mb-2 text-left">
                    <div className="font-black">✅ Claim successful</div>

                    <div className="mt-1 text-xs">
                      Day {lastClaim.claimedDay} · Expected {fmt(lastClaim.expectedReward)} TYSM
                      {lastClaim.actualReward
                        ? ` · Paid ${Number(lastClaim.actualReward).toLocaleString("en-US", {
                            maximumFractionDigits: 0,
                          })} TYSM`
                        : ""}
                    </div>

                    <div className="mt-2 flex gap-2">
                      <button
                        className="rounded-lg bg-green-500/20 px-3 py-1 text-xs font-bold"
                        onClick={() =>
                          sdk.actions.openUrl(`https://basescan.org/tx/${lastClaim.txHash}`)
                        }
                      >
                        View on BaseScan
                      </button>

                      <button
                        className="rounded-lg bg-white/10 px-3 py-1 text-xs font-bold"
                        onClick={() => navigator.clipboard.writeText(lastClaim.txHash)}
                      >
                        Copy Tx
                      </button>
                    </div>
                  </div>
                )}
                {!hasShared ? (
                  <div className="space-y-2">
                    <button onClick={handleShareFirst} className="w-full font-black py-3.5 rounded-xl text-base transition-all active:scale-95 flex items-center justify-center gap-2 text-white" style={{ background: "linear-gradient(135deg,#7c3aed,#6d28d9)" }}>
                      ⚡ Share First → Unlock Claim!
                    </button>
                    <p className="text-gray-600 text-[10px]">Share to unlock the Claim button 🙏</p>
                  </div>
                ) : (
                  <button onClick={handleClaim} disabled={isBusy || !isConnected} className="w-full font-black py-4 rounded-xl text-lg transition-all active:scale-95 text-white" style={{ background: isBusy || !isConnected ? "#374151" : "linear-gradient(90deg,#f59e0b,#fcd34d)" }}>
                    {isBusy ? "Processing..." : "🙏 Claim Free $TYSM"}
                  </button>
                )}
              </>
            ) : (
              <div className="py-2">
                <div className="inline-flex items-center gap-1.5 bg-gray-950 border border-gray-800 rounded-full px-3 py-1 mb-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-600" />
                  <p className="text-gray-500 text-[11px] font-bold uppercase tracking-wider">Claimed · Next in</p>
                </div>
                <p className="font-mono text-3xl font-black text-gray-400 tracking-wider mb-1">
                  {formatCountdown(countdown)}
                </p>
                <p className="text-gray-600 text-[11px] font-mono mb-2">
                  Available {nextClaimUTC(countdown)}
                </p>
                <button onClick={handleShareAfter} className="w-full font-bold py-2.5 rounded-xl text-xs bg-white/5 border border-white/10 hover:bg-white/10 transition-all flex items-center justify-center gap-1.5 text-gray-300">
                  📢 Broadcast Your Streak
                </button>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button onClick={handleEnableNotif}
                    className="font-bold py-2 rounded-xl text-[11px] flex items-center justify-center gap-1 transition-all active:scale-95"
                    style={{ background: notifEnabled ? "rgba(124,58,237,0.2)" : "rgba(255,255,255,0.04)", border: notifEnabled ? "1px solid rgba(124,58,237,0.5)" : "1px solid rgba(124,58,237,0.25)", color: notifEnabled ? "#c4b5fd" : "#a78bfa" }}>
                    {notifEnabled ? "🔔 On!" : "🔔 Notify Me"}
                  </button>
                  <button onClick={handleCopyReferral}
                    className="font-bold py-2 rounded-xl text-[11px] flex items-center justify-center gap-1 transition-all active:scale-95"
                    style={{ background: copied ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.04)", border: copied ? "1px solid rgba(16,185,129,0.5)" : "1px solid rgba(59,130,246,0.25)", color: copied ? "#6ee7b7" : "#93c5fd" }}>
                    {copied ? "✅ Copied!" : "🔗 Invite Friend"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {claimHistory.length > 0 && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-left">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-black">Recent Claims</h3>
                <span className="text-[10px] text-gray-400">last 10</span>
              </div>

              <div className="space-y-2">
                {claimHistory.map((item) => (
                  <div
                    key={item.txHash}
                    className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2"
                  >
                    <div>
                      <div className="text-xs font-bold">
                        Day {item.claimedDay} ·{" "}
                        {item.actualReward
                          ? `${Number(item.actualReward).toLocaleString("en-US", {
                              maximumFractionDigits: 0,
                          })} TYSM`
                          : `${fmt(item.expectedReward)} TYSM expected`}
                      </div>

                      <div className="text-[10px] text-gray-500">
                        {new Date(item.createdAt).toLocaleString()}
                      </div>
                    </div>

                    <button
                      className="rounded-lg bg-purple-500/20 px-2 py-1 text-[10px] font-bold text-purple-200"
                      onClick={() =>
                        sdk.actions.openUrl(`https://basescan.org/tx/${item.txHash}`)
                      }
                    >
                      BaseScan
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "board" && (
        <div className="max-w-sm mx-auto px-4 pt-4 pb-24 space-y-4">
          <div className="text-center py-2">
            <h2 className="text-2xl font-black shimmer-text">Global Leaderboard</h2>
            <p className="text-gray-500 text-[11px]">The most loyal $TYSM claimers in the ecosystem</p>
          </div>

          <div className="bg-white/4 border border-white/8 rounded-2xl overflow-hidden">
            <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <p className="text-gray-300 text-xs font-bold">🏆 Community Ranks</p>
                <span className="flex items-center gap-1 bg-green-900/30 border border-green-700/30 rounded-full px-2 py-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-green-400 text-[9px] font-bold">LIVE</span>
                </span>
              </div>
              <p className="text-gray-600 text-[9px]">
                {lbLoading ? "Updating..." : lbUpdatedAt > 0 ? "Updated" : ""}
              </p>
            </div>

            {lbError && (
              <div className="px-3 py-3 bg-red-950/20 border-b border-red-800/20 flex flex-col items-center gap-2">
                <p className="text-red-400 text-[10px] text-center">Failed to load leaderboard data.</p>
                <button
                  onClick={() => { setLbError(false); setLbRetryKey(k => k + 1); }}
                  className="text-[10px] font-bold text-yellow-400 bg-yellow-950/40 border border-yellow-700/30 rounded-full px-3 py-1 active:scale-95 transition-all">
                  🔄 Retry
                </button>
              </div>
            )}

            <div className="grid grid-cols-12 gap-1 px-3 py-1.5 border-b border-white/5">
              <p className="col-span-1 text-gray-600 text-[9px] font-bold uppercase">#</p>
              <p className="col-span-4 text-gray-600 text-[9px] font-bold uppercase">User</p>
              <p className="col-span-2 text-gray-600 text-[9px] font-bold uppercase text-center">Days</p>
              <p className="col-span-2 text-gray-600 text-[9px] font-bold uppercase text-center">Rate</p>
              <p className="col-span-3 text-gray-600 text-[9px] font-bold uppercase text-center">Shield</p>
            </div>

            {lbLoading && liveLeaderboard.length === 0 && (
              <div className="divide-y divide-white/5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="grid grid-cols-12 gap-1 px-3 py-2.5 items-center animate-pulse">
                    <div className="col-span-1 h-3 bg-white/10 rounded" />
                    <div className="col-span-4 h-3 bg-white/10 rounded" />
                    <div className="col-span-2 h-3 bg-white/10 rounded mx-auto w-8" />
                    <div className="col-span-2 h-3 bg-white/10 rounded mx-auto w-6" />
                    <div className="col-span-3 h-3 bg-white/10 rounded mx-auto w-8" />
                  </div>
                ))}
              </div>
            )}

            {!lbLoading && liveLeaderboard.length === 0 && !lbError && (
              <div className="px-3 py-8 text-center">
                <p className="text-gray-600 text-xs">No claimers found yet</p>
                <p className="text-gray-700 text-[10px] mt-1">Be the first to claim!</p>
              </div>
            )}

            {liveLeaderboard.length > 0 && (() => {
              const LB_PER_PAGE = 10;
              const totalPages  = Math.ceil(liveLeaderboard.length / LB_PER_PAGE);
              const pageRows    = liveLeaderboard.slice((lbPage - 1) * LB_PER_PAGE, lbPage * LB_PER_PAGE);

              const pageNums = (() => {
                if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
                const pages: (number | "...")[] = [1];
                if (lbPage > 3) pages.push("...");
                for (let p = Math.max(2, lbPage - 1); p <= Math.min(totalPages - 1, lbPage + 1); p++) pages.push(p);
                if (lbPage < totalPages - 2) pages.push("...");
                pages.push(totalPages);
                return pages;
              })();

              return (
                <>
                  <div className="divide-y divide-white/5">
                    {pageRows.map((row) => {
                      const ci        = getCycleInfo(row.totalDays);
                      const rankColor =
                        row.rank === 1 ? "#f59e0b"
                        : row.rank === 2 ? "#9ca3af"
                        : row.rank === 3 ? "#d97706"
                        : "#4b5563";
                      return (
                        <div key={row.address}
                          className="grid grid-cols-12 gap-1 px-3 py-2.5 items-center transition-colors hover:bg-white/3">
                          <p className="col-span-1 font-black text-sm" style={{ color: rankColor }}>
                            {row.rank <= 3 ? ["🥇", "🥈", "🥉"][row.rank - 1] : row.rank}
                          </p>
                          <div className="col-span-4 flex items-center gap-1 min-w-0">
                            <p className="text-gray-300 text-[11px] font-medium truncate">{row.handle}</p>
                            <CycleBadge cycle={ci.cycle} />
                          </div>
                          <p className="col-span-2 text-yellow-400 font-black text-[11px] text-center">{row.totalDays}🔥</p>
                          <p className="col-span-2 text-green-400 text-[10px] font-bold text-center">
                            {(ci.baseRate / 1000).toFixed(0)}K
                          </p>
                          <div className="col-span-3 flex justify-center">
                            <span className="text-[9px] font-bold rounded-full px-1.5 py-0.5"
                              style={{ color: heartColor(row.hearts), background: heartBg(row.hearts), border: `1px solid ${heartColor(row.hearts)}40` }}>
                              {row.hearts}/3
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-1 px-3 py-3 border-t border-white/5">
                      <button
                        onClick={() => setLbPage(p => Math.max(1, p - 1))}
                        disabled={lbPage === 1}
                        className="w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center transition-all disabled:opacity-30"
                        style={{ background: "rgba(255,255,255,0.05)", color: "#9ca3af" }}>
                        ‹
                      </button>
                      {pageNums.map((p, i) =>
                        p === "..." ? (
                          <span key={`dot-${i}`} className="w-7 h-7 flex items-center justify-center text-gray-600 text-xs">…</span>
                        ) : (
                          <button
                            key={p}
                            onClick={() => setLbPage(p as number)}
                            className="w-7 h-7 rounded-full text-[11px] font-bold flex items-center justify-center transition-all active:scale-95"
                            style={lbPage === p
                              ? { background: "#7c3aed", color: "#fff", boxShadow: "0 0 8px rgba(124,58,237,0.5)" }
                              : { background: "rgba(255,255,255,0.05)", color: "#6b7280" }}>
                            {p}
                          </button>
                        )
                      )}
                      <button
                        onClick={() => setLbPage(p => Math.min(totalPages, p + 1))}
                        disabled={lbPage === totalPages}
                        className="w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center transition-all disabled:opacity-30"
                        style={{ background: "rgba(255,255,255,0.05)", color: "#9ca3af" }}>
                        ›
                      </button>
                    </div>
                  )}
                </>
              );
            })()}

            <div className="px-3 py-2 border-t border-white/5">
              <p className="text-gray-700 text-[9px] text-center">
                Refreshed on tab open · Sorted by Total Days claimed
              </p>
            </div>
          </div>
        </div>
      )}

      {activeTab === "rewards" && (
        <div className="max-w-sm mx-auto px-4 pt-4 pb-8 space-y-4">
          {/* Referral Section */}
          {(() => {
            const pendingRefWei  = (pendingRefData as bigint | undefined) ?? BigInt(0);
            const hasPending     = pendingRefWei > BigInt(0);
            const pendingFmt     = hasPending ? formatUnits(pendingRefWei, 18).replace(/\.(\d{0,0})\d*$/, "") : "0";
            const isClaimBusy    = isRefClaimPending || isRefClaimLoading;
            return (
              <div className="bg-white/4 border border-purple-700/30 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-purple-300 font-black text-sm">🔗 Invite Friends</p>
                    <p className="text-gray-500 text-[10px] mt-0.5">Share your link — tracked automatically</p>
                  </div>
                  <div className="text-right">
                    <p className="text-purple-400 font-black text-xl leading-none">
                      {refLoading ? "…" : (refCount ?? 0)}
                    </p>
                    <p className="text-gray-600 text-[9px] uppercase tracking-wider">Friends</p>
                  </div>
                </div>

                {isConnected && address ? (
                  <>
                    <div className="bg-black/30 border border-white/8 rounded-xl px-3 py-2 flex items-center gap-2">
                      <p className="text-gray-400 text-[10px] flex-1 truncate font-mono">
                        {APP_URL}?ref={address.slice(0, 8)}…
                      </p>
                      <button onClick={handleCopyRefLink}
                        className="shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full transition-all active:scale-95"
                        style={{
                          background: refCopied ? "rgba(16,185,129,0.2)" : "rgba(124,58,237,0.2)",
                          border: refCopied ? "1px solid rgba(16,185,129,0.5)" : "1px solid rgba(124,58,237,0.4)",
                          color: refCopied ? "#6ee7b7" : "#c4b5fd"
                        }}>
                        {refCopied ? "✅ Copied!" : "📋 Copy"}
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5 text-center">
                      {[
                        { range: "1–5",  reward: "5K",  color: "#a78bfa" },
                        { range: "6–10", reward: "8K",  color: "#818cf8" },
                        { range: "11+",  reward: "12K", color: "#6366f1" },
                      ].map(t => (
                        <div key={t.range} className="bg-white/4 border border-white/8 rounded-xl py-2">
                          <p className="font-black text-xs" style={{ color: t.color }}>{t.reward} $TYSM</p>
                          <p className="text-gray-600 text-[9px]">per ref ({t.range})</p>
                        </div>
                      ))}
                    </div>

                    {referralReady && (
                      <div className="flex items-center justify-between bg-black/20 border border-purple-800/30 rounded-xl px-3 py-2.5">
                        <div>
                          <p className="text-gray-500 text-[9px] uppercase tracking-wider">Claimable Reward</p>
                          <p className="text-purple-300 font-black text-base leading-tight">
                            {hasPending ? `${Number(pendingFmt).toLocaleString()} $TYSM` : "—"}
                          </p>
                        </div>
                        <button
                          disabled={!hasPending || isClaimBusy}
                          onClick={() => writeRefClaim({ address: REFERRAL_ADDRESS, abi: REFERRAL_ABI, functionName: "claimRewards", chainId: base.id })}
                          className="text-[11px] font-bold px-3 py-1.5 rounded-full transition-all active:scale-95 disabled:opacity-40"
                          style={{ background: hasPending ? "rgba(124,58,237,0.3)" : "rgba(255,255,255,0.05)", border: "1px solid rgba(124,58,237,0.4)", color: "#c4b5fd" }}>
                          {isClaimBusy ? "Claiming…" : "Claim 🎁"}
                        </button>
                      </div>
                    )}

                    <p className="text-gray-600 text-[10px] text-center leading-relaxed">
                      When your friend opens the app via your link → tracked automatically
                    </p>
                  </>
                ) : (
                  <p className="text-gray-600 text-[11px] text-center py-1">
                    🔌 Connect your wallet to see your referral link
                  </p>
                )}
              </div>
            );
          })()}

          {/* Reward Structure */}
          <div>
            <h3 className="text-center text-xs font-black text-gray-400 uppercase tracking-widest mb-3">Daily Reward Structure</h3>
            <div className="space-y-3">
              <div className="bg-white/4 border border-yellow-500/25 rounded-2xl overflow-hidden">
                <div className="bg-yellow-500/10 px-3 py-2.5 flex items-center justify-between">
                  <span className="text-yellow-400 font-black text-xs">🥉 Cycle 1 · Days 1–30</span>
                  <span className="text-yellow-300 font-bold text-xs">2,000 / day</span>
                </div>
                <div className="divide-y divide-white/5">
                  {[
                    { day: 7,  label: "🔥 Week 1",     bonus: "+10K" },
                    { day: 15, label: "🌟 Mid Month",  bonus: "+40K" },
                    { day: 30, label: "👑 Full Month",  bonus: "+90K" },
                  ].map(m => (
                    <div key={m.day} className="grid grid-cols-3 px-3 py-2 text-[11px]">
                      <span className="text-gray-500">Day {m.day}</span>
                      <span className="text-gray-300 text-center">{m.label}</span>
                      <span className="text-green-400 font-bold text-right">{m.bonus}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white/4 border border-gray-400/25 rounded-2xl overflow-hidden">
                <div className="bg-gray-400/10 px-3 py-2.5 flex items-center justify-between">
                  <span className="text-gray-300 font-black text-xs">🥈 Cycle 2 · Days 31–60</span>
                  <span className="text-emerald-300 font-bold text-xs">2,000 / day</span>
                </div>
                <div className="divide-y divide-white/5">
                  {[
                    { day: 37, label: "🔥 Week 1",     bonus: "+20K"  },
                    { day: 45, label: "🌟 Mid Month",  bonus: "+80K"  },
                    { day: 60, label: "👑 Full Month",  bonus: "+180K" },
                  ].map(m => (
                    <div key={m.day} className="grid grid-cols-3 px-3 py-2 text-[11px]">
                      <span className="text-gray-500">Day {m.day}</span>
                      <span className="text-gray-300 text-center">{m.label}</span>
                      <span className="text-green-400 font-bold text-right">{m.bonus}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white/4 border border-purple-400/25 rounded-2xl overflow-hidden">
                <div className="bg-purple-400/10 px-3 py-2.5 flex items-center justify-between">
                  <span className="text-purple-300 font-black text-xs">🥇👑 Cycle 3 · Days 61+</span>
                  <span className="text-purple-300 font-bold text-xs">2,000 / day</span>
                </div>
                <div className="divide-y divide-white/5">
                  {[
                    { day: 67, label: "🔥 Week 1",     bonus: "+20K"  },
                    { day: 75, label: "🌟 Mid Month",  bonus: "+80K"  },
                    { day: 90, label: "👑 Full Month",  bonus: "+180K" },
                  ].map(m => (
                    <div key={m.day} className="grid grid-cols-3 px-3 py-2 text-[11px]">
                      <span className="text-gray-500">Day {m.day}</span>
                      <span className="text-gray-300 text-center">{m.label}</span>
                      <span className="text-green-400 font-bold text-right">{m.bonus}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <p className="text-gray-700 text-[9px] text-center mt-3">Infinite progression · No resets · Keep claiming every day!</p>
          </div>
        </div>
      )}

      {activeTab === "board" && (
        <div className="fixed bottom-0 left-0 right-0 z-50 leaderboard-me px-4 py-2.5 backdrop-blur-sm">
          <div className="max-w-sm mx-auto grid grid-cols-12 gap-1 items-center">
            <p className="col-span-1 text-yellow-400 font-black text-sm">{myRank ? `#${myRank}` : "—"}</p>
            <div className="col-span-4 flex items-center gap-1">
              <p className="text-yellow-300 text-[11px] font-bold truncate">
                @{userCtx?.user?.username || "you"}
              </p>
              <CycleBadge cycle={cycleInfo.cycle} />
            </div>
            <p className="col-span-2 text-yellow-400 font-black text-[11px] text-center">{totalDays}🔥</p>
            <p className="col-span-2 text-green-400 text-[10px] font-bold text-center">
              {(cycleInfo.baseRate/1000).toFixed(0)}K
            </p>
            <div className="col-span-3 flex justify-center">
              <span className="text-[9px] font-bold rounded-full px-1.5 py-0.5"
                style={{ color: heartColor(hearts), background: heartBg(hearts), border: `1px solid ${heartColor(hearts)}40` }}>
                {hearts}/3
              </span>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
