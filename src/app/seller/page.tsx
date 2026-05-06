"use client"

import { useAuth } from "@/lib/useAuth";
import { RegisterModal } from "@/components/RegisterModal";
import { getMyOrders, generateOtp } from "@/lib/api";
import { ConnectButton } from "@rainbow-me/rainbowkit"
import Link from "next/link"
import { useState, useEffect, useCallback, useRef } from "react"
import {
    ArrowLeft,
    MapPin,
    Zap,
    Plus,
    Trash2,
    Package,
    CheckCircle,
    Clock,
    Copy,
    ExternalLink,
    RefreshCw,
    Eye,
    EyeOff,
    Hash,
    Loader2,
} from "lucide-react"
import {
    useAccount,
    useReadContract,
    useWriteContract,
    useWaitForTransactionReceipt,
    useReadContracts,
    usePublicClient,
} from "wagmi"
import { encodeZone, ESCROW_ABI, ESCROW_CONTRACT_ADDRESS, ORDER_STATUS } from "@/constants"
import { parseUnits, keccak256, toBytes } from "viem"

// ─── Types ────────────────────────────────────────────────────────────────────

type ActiveOrder = {
    id: number
    buyer: string
    zone: string
    /** Raw USDC amount — 6 decimal places. e.g. 8_000_000n = $8.00 */
    usdcAmount: bigint
    status: number
    createdAt: bigint
    deliveredAt: bigint
    confirmedAt: bigint
}

type ZoneInput = { name: string; key: string; price: string }

type ToastState = { msg: string; type: "success" | "error" | "info" } | null

// ─── Constants ────────────────────────────────────────────────────────────────

/** How many decimals USDC uses. Defined once so it's easy to change. */
const USDC_DECIMALS = 6

const PRESET_ZONES: ZoneInput[] = [
    { name: "Lekki", key: "lekki", price: "" },
    { name: "Victoria Island", key: "vi", price: "" },
    { name: "Ikoyi", key: "ikoyi", price: "" },
    { name: "Surulere", key: "surulere", price: "" },
    { name: "Ikeja", key: "ikeja", price: "" },
    { name: "Yaba", key: "yaba", price: "" },
    { name: "Ajah", key: "ajah", price: "" },
    { name: "Festac", key: "festac", price: "" },
]

// ─── Utils ────────────────────────────────────────────────────────────────────

function shortAddr(addr: string) {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

/** Converts a raw USDC bigint to a display string e.g. 8_000_000n → "$8.00" */
function formatUsdc(val: bigint) {
    return `$${(Number(val) / 10 ** USDC_DECIMALS).toFixed(2)}`
}

function generateOTP(): { otp: string; hash: `0x${string}` } {
    const otp = Math.floor(100000 + Math.random() * 900000).toString()
    const hash = keccak256(toBytes(otp))
    return { otp, hash }
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ msg, type, onClose }: { msg: string; type: "success" | "error" | "info"; onClose: () => void }) {
    useEffect(() => {
        const t = setTimeout(onClose, 4000)
        return () => clearTimeout(t)
    }, [onClose])

    const colors = { success: "var(--green)", error: "var(--red)", info: "var(--orange-text)" }

    return (
        <div style={{ position: "fixed", bottom: "2rem", right: "2rem", zIndex: 9999, background: "var(--card)", border: `1px solid ${colors[type]}`, borderRadius: "8px", padding: ".875rem 1.25rem", display: "flex", alignItems: "center", gap: "10px", fontSize: ".82rem", color: "var(--text)", maxWidth: "340px", boxShadow: "0 8px 32px rgba(0,0,0,.4)", animation: "fadeUp .3s ease both" }}>
            <span style={{ color: colors[type], fontSize: "1rem" }}>{type === "success" ? "✓" : type === "error" ? "✕" : "·"}</span>
            {msg}
            <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: "1rem" }}>×</button>
        </div>
    )
}

// ─── OTP Modal ────────────────────────────────────────────────────────────────

function OTPModal({ orderId, onClose, onConfirm }: {
    orderId: number
    onClose: () => void
    onConfirm: (hash: `0x${string}`, otp: string) => Promise<void>
}) {
    const [generated, setGenerated] = useState<{ otp: string; hash: `0x${string}` } | null>(null)
    const [revealed, setRevealed] = useState(false)
    const [copied, setCopied] = useState(false)
    const [submitting, setSubmitting] = useState(false)

    const generate = () => { setGenerated(generateOTP()); setRevealed(false) }
    const copy = (text: string) => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
    }

    const handleConfirm = async () => {
        if (!generated) return
        setSubmitting(true)
        try {
            await onConfirm(generated.hash, generated.otp)
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(12,12,11,0.88)", backdropFilter: "blur(12px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
            <div style={{ background: "var(--card)", border: "1px solid var(--border2)", borderRadius: "14px", width: "100%", maxWidth: "480px", overflow: "hidden" }}>
                {/* Header */}
                <div style={{ padding: "1.5rem 1.75rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                        <div style={{ fontSize: ".65rem", fontFamily: "var(--mono)", color: "var(--muted)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: ".3rem" }}>Order #{orderId}</div>
                        <div style={{ fontSize: "1rem", fontWeight: 800, fontFamily: "'Cabinet Grotesk', sans-serif", letterSpacing: "-.02em" }}>Generate OTP</div>
                    </div>
                    <button onClick={onClose} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--muted)", cursor: "pointer", width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem" }}>×</button>
                </div>

                {/* Body */}
                <div style={{ padding: "1.75rem" }}>
                    <p style={{ fontSize: ".82rem", color: "var(--muted)", lineHeight: 1.75, marginBottom: "1.5rem" }}>
                        Generate a one-time code. Send the <strong style={{ color: "var(--text)" }}>raw OTP</strong> to the buyer (SMS / app). Only the hash goes on-chain.
                    </p>
                    {!generated ? (
                        <button onClick={generate} className="dp-btn-primary" style={{ width: "100%", justifyContent: "center" }}>
                            <Hash size={16} /> Generate OTP
                        </button>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                            {/* Raw OTP */}
                            <div style={{ background: "var(--surface)", border: "1px solid var(--border2)", borderRadius: "8px", padding: "1.25rem" }}>
                                <div style={{ fontSize: ".65rem", fontFamily: "var(--mono)", color: "var(--muted)", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: ".75rem" }}>Raw OTP — share with buyer</div>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
                                    <div style={{ fontFamily: "var(--mono)", fontSize: "2rem", fontWeight: 700, letterSpacing: ".25em", color: revealed ? "var(--orange-text)" : "transparent", textShadow: revealed ? "none" : "0 0 12px var(--orange-text)", filter: revealed ? "none" : "blur(6px)", transition: "all .3s", userSelect: revealed ? "text" : "none" }}>
                                        {generated.otp}
                                    </div>
                                    <div style={{ display: "flex", gap: "8px" }}>
                                        <button onClick={() => setRevealed(r => !r)} title={revealed ? "Hide OTP" : "Reveal OTP"} style={{ background: "var(--card2)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--muted)", cursor: "pointer", width: "34px", height: "34px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
                                        </button>
                                        <button onClick={() => copy(generated.otp)} title="Copy OTP" style={{ background: "var(--card2)", border: "1px solid var(--border)", borderRadius: "6px", color: copied ? "var(--green)" : "var(--muted)", cursor: "pointer", width: "34px", height: "34px", display: "flex", alignItems: "center", justifyContent: "center", transition: "color .2s" }}>
                                            <Copy size={14} />
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Hash */}
                            <div style={{ background: "var(--faint)", border: "1px solid var(--border)", borderRadius: "8px", padding: "1rem" }}>
                                <div style={{ fontSize: ".65rem", fontFamily: "var(--mono)", color: "var(--subtle)", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: ".5rem" }}>Hash stored on-chain</div>
                                <div style={{ fontFamily: "var(--mono)", fontSize: ".68rem", color: "var(--subtle)", wordBreak: "break-all", lineHeight: 1.6 }}>{generated.hash}</div>
                            </div>

                            {/* Regenerate */}
                            <button onClick={generate} style={{ background: "none", border: "1px solid var(--border2)", borderRadius: "6px", color: "var(--muted)", cursor: "pointer", padding: ".65rem 1rem", fontSize: ".8rem", fontFamily: "'Cabinet Grotesk', sans-serif", display: "flex", alignItems: "center", gap: "6px", justifyContent: "center" }}>
                                <RefreshCw size={13} /> Regenerate
                            </button>

                            {/* Submit — shows spinner while tx is pending */}
                            <button
                                onClick={handleConfirm}
                                disabled={submitting}
                                className="dp-btn-primary"
                                style={{ justifyContent: "center", opacity: submitting ? 0.7 : 1 }}
                            >
                                {submitting
                                    ? <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Submitting to chain…</>
                                    : <><Package size={16} /> Submit to chain — markDelivered()</>
                                }
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SellerPage() {
    const { address, isConnected, chain } = useAccount()
    const { writeContractAsync } = useWriteContract()
    const publicClient = usePublicClient()
    const { user, setUser, authenticated, login, loading: authLoading } = useAuth();

    const [toast, setToast] = useState<ToastState>(null)
    const [tab, setTab] = useState<"dashboard" | "zones" | "orders">("dashboard")
    const [zonePrices, setZonePrices] = useState<Record<string, string>>({})
    const [pendingZone, setPendingZone] = useState<string | null>(null)
    const [pendingAvail, setPendingAvail] = useState(false)
    const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
    const [otpModal, setOtpModal] = useState<number | null>(null)
    const [sellerOrders, setSellerOrders] = useState<ActiveOrder[]>([])
    const [loadingOrders, setLoadingOrders] = useState(false)

    /**
     * Cache the last block we fetched from so subsequent refreshes
     * only scan new blocks instead of rescanning full chain history every time.
     */

    const { isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash })

    useEffect(() => {
        if (txSuccess) {
            setToast({ msg: "Transaction confirmed on-chain ✓", type: "success" })
            setTxHash(undefined)
            setPendingZone(null)
            setPendingAvail(false)
        }
    }, [txSuccess])

    const showToast = useCallback(
        (msg: string, type: "success" | "error" | "info" = "info") => setToast({ msg, type }),
        []
    )

    // ── Contract reads ─────────────────────────────────────────────────────────

    const { data: isAvailable, refetch: refetchAvail } = useReadContract({
        address: ESCROW_CONTRACT_ADDRESS,
        abi: ESCROW_ABI,
        functionName: "sellerAvailable",
        args: address ? [address] : undefined,
        query: { enabled: !!address },
    })

    const zoneContracts = PRESET_ZONES.map(z => ({
        address: ESCROW_CONTRACT_ADDRESS,
        abi: ESCROW_ABI,
        functionName: "getPrice" as const,
        args: address ? [address, encodeZone(z.key)] : undefined,
    }))

    const { data: zonePriceData, refetch: refetchZones } = useReadContracts({
        contracts: zoneContracts,
        query: { enabled: !!address },
    })

    /** Prices keyed by zone key, in raw USDC units (6 decimals). */
    const onChainPrices: Record<string, bigint> = {}
    if (zonePriceData) {
        PRESET_ZONES.forEach((z, i) => {
            const res = zonePriceData[i]
            if (res?.status === "success" && res.result) {
                onChainPrices[z.key] = res.result as bigint
            }
        })
    }

    // ── Fetch orders ───────────────────────────────────────────────────────────
    const fetchSellerOrders = useCallback(async () => {
        if (!address || !publicClient) return
        setLoadingOrders(true)
        try {
            const backendOrders = await getMyOrders()
            if (backendOrders.length === 0) { setLoadingOrders(false); return }

            const orders = await Promise.all(
                backendOrders.map(async (backendOrder: any) => {
                    try {
                        const order = await publicClient.readContract({
                            address: ESCROW_CONTRACT_ADDRESS,
                            abi: ESCROW_ABI,
                            functionName: "getOrder",
                            args: [BigInt(backendOrder.onchainId)],
                        } as any) as any

                        return {
                            id: Number(backendOrder.onchainId),
                            buyer: order.buyer as string,
                            zone: order.zone as string,
                            usdcAmount: order.usdcAmount as bigint,
                            status: Number(order.status),
                            createdAt: order.createdAt as bigint,
                            deliveredAt: order.deliveredAt as bigint,
                            confirmedAt: order.confirmedAt as bigint,
                        } satisfies ActiveOrder
                    } catch { return null }
                })
            )

            const valid = orders.filter((o): o is ActiveOrder => o !== null)
            setSellerOrders(valid.sort((a, b) => b.id - a.id))

            // Auto-release eligible orders
            const block = await publicClient.getBlock()
            const chainNow = Number(block.timestamp)

            for (const order of valid) {
                const isCompleted = order.status === 2
                const confirmedAt = Number(order.confirmedAt)
                const deadline = confirmedAt + 7200
                if (isCompleted && confirmedAt > 0 && chainNow >= deadline) {
                    try {
                        await writeContractAsync({
                            address: ESCROW_CONTRACT_ADDRESS,
                            abi: ESCROW_ABI,
                            functionName: "releaseFunds",
                            args: [BigInt(order.id)],
                            chain,
                            account: address,
                            gas: BigInt(200000),
                        })
                        showToast(`Funds released for order #${order.id} ✓`, "success")
                    } catch (e) {
                        // silently ignore
                    }
                }
            }

        } catch (e) {
            showToast("Failed to fetch orders from chain", "error")
        } finally {
            setLoadingOrders(false)
        }
    }, [address, publicClient, showToast])
    // ── Actions ───────────────────────────────────────────────────────────────

    const toggleAvailability = async () => {
        if (!isConnected) return showToast("Connect your wallet first", "error")
        setPendingAvail(true)
        try {
            const hash = await writeContractAsync({
                address: ESCROW_CONTRACT_ADDRESS,
                abi: ESCROW_ABI,
                functionName: "setAvailability",
                args: [!isAvailable],
                chain,
                account: address,
            })
            setTxHash(hash)
            showToast(`${!isAvailable ? "Going online" : "Going offline"}…`, "info")
            setTimeout(() => refetchAvail(), 3000)
        } catch (e: unknown) {
            setPendingAvail(false)
            showToast((e as Error)?.message?.slice(0, 80) || "Transaction failed", "error")
        }
    }

    const setZonePrice = async (zoneKey: string) => {
        if (!isConnected) return showToast("Connect your wallet first", "error")
        const priceStr = zonePrices[zoneKey]
        if (!priceStr || isNaN(parseFloat(priceStr)) || parseFloat(priceStr) <= 0) {
            return showToast("Enter a valid USDC price", "error")
        }
        try {
            const usdcAmount = parseUnits(priceStr, USDC_DECIMALS)
            setPendingZone(zoneKey)
            const hash = await writeContractAsync({
                address: ESCROW_CONTRACT_ADDRESS,
                abi: ESCROW_ABI,
                functionName: "setPrice",
                args: [encodeZone(zoneKey), usdcAmount],
                chain,
                account: address,
            })
            setTxHash(hash)
            showToast(`Setting price for ${zoneKey}…`, "info")
            setTimeout(() => refetchZones(), 3000)
        } catch (e: unknown) {
            setPendingZone(null)
            showToast((e as Error)?.message?.slice(0, 80) || "Transaction failed", "error")
        }
    }

    const removeZonePrice = async (zoneKey: string) => {
        if (!isConnected) return showToast("Connect your wallet first", "error")
        try {
            const hash = await writeContractAsync({
                address: ESCROW_CONTRACT_ADDRESS,
                abi: ESCROW_ABI,
                functionName: "removePrice",
                args: [encodeZone(zoneKey)],
                chain,
                account: address,
            })
            setTxHash(hash)
            showToast(`Removing ${zoneKey} price…`, "info")
            setTimeout(() => refetchZones(), 3000)
        } catch (e: unknown) {
            showToast((e as Error)?.message?.slice(0, 80) || "Transaction failed", "error")
        }
    }

    const handleMarkDelivered = async (orderId: number, otpHash: `0x${string}`) => {
        try {
            const hash = await writeContractAsync({
                address: ESCROW_CONTRACT_ADDRESS,
                abi: ESCROW_ABI,
                functionName: "markDelivered",
                args: [BigInt(orderId), otpHash],
                chain,
                account: address,
            })
            setTxHash(hash)

            // Get OTP from backend after marking delivered on-chain
            const backendOrders = await getMyOrders()
            const backendOrder = backendOrders.find((o: any) => o.onchainId === orderId.toString())
            if (backendOrder) {
                const otp = await generateOtp(backendOrder.id)
                showToast(`OTP for order #${orderId}: ${otp} — send to buyer!`, "success")
            }

            setOtpModal(null)
            setTimeout(() => fetchSellerOrders(), 4000)
        } catch (e: any) {
            showToast(e?.message?.slice(0, 80) || "Failed to mark delivered", "error")
        }
    }

    const configuredZones = PRESET_ZONES.filter(z => onChainPrices[z.key] && onChainPrices[z.key] > BigInt(0))

    // ── Not connected ─────────────────────────────────────────────────────────

    if (!isConnected) {
        return (
            <main style={{ fontFamily: "'Cabinet Grotesk', 'Satoshi', sans-serif", background: "#0C0C0B", color: "#F0EDE6", minHeight: "100vh" }}>
                <Style />
                <nav className="dp-nav">
                    <Link className="dp-logo" href="/"><div className="dp-logo-mark">D</div><span className="dp-logo-text">DispatchPay</span></Link>
                    <div className="dp-nav-right"><ConnectButton /></div>
                </nav>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", flexDirection: "column", gap: "1.5rem", padding: "2rem" }}>
                    <div style={{ width: "52px", height: "52px", background: "var(--orange-glow)", border: "1px solid var(--orange-border)", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Package size={22} style={{ color: "var(--orange-text)" }} />
                    </div>
                    <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: "1.2rem", fontWeight: 900, letterSpacing: "-.03em", marginBottom: ".5rem" }}>Connect to access seller dashboard</div>
                        <div style={{ fontSize: ".85rem", color: "var(--muted)" }}>Manage zones, availability, and orders</div>
                    </div>
                    <ConnectButton />
                </div>
            </main>
        )
    }

    if (isConnected && !authenticated) {
        return (
            <main style={{ fontFamily: "'Cabinet Grotesk', 'Satoshi', sans-serif", background: "#0C0C0B", color: "#F0EDE6", minHeight: "100vh" }}>
                <Style />
                <nav className="dp-nav">
                    <Link className="dp-logo" href="/"><div className="dp-logo-mark">D</div><span className="dp-logo-text">DispatchPay</span></Link>
                    <div className="dp-nav-right"><ConnectButton /></div>
                </nav>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", flexDirection: "column", gap: "1.5rem", padding: "2rem", textAlign: "center" }}>
                    <div style={{ fontSize: "1.2rem", fontWeight: 900, letterSpacing: "-.03em" }}>Sign in to continue</div>
                    <div style={{ fontSize: ".85rem", color: "var(--muted)" }}>Sign a message with your wallet to authenticate</div>
                    <button className="dp-btn-primary" onClick={login} disabled={authLoading}>
                        {authLoading ? "Signing in…" : "Sign in with wallet"}
                    </button>
                </div>
            </main>
        );
    }

    if (authenticated && !user?.name) {
        return (
            <>
                <Style />
                <RegisterModal onSuccess={(u) => setUser(u)} />
            </>
        )
    }

    // ── Connected ─────────────────────────────────────────────────────────────

    return (
        <main style={{ fontFamily: "'Cabinet Grotesk', 'Satoshi', sans-serif", background: "#0C0C0B", color: "#F0EDE6", minHeight: "100vh" }}>
            <Style />

            <nav className="dp-nav">
                <Link className="dp-logo" href="/"><div className="dp-logo-mark">D</div><span className="dp-logo-text">DispatchPay</span></Link>
                <div className="dp-nav-right">
                    <Link href="/" style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: ".82rem", color: "var(--muted)", textDecoration: "none" }}>
                        <ArrowLeft size={14} /> Home
                    </Link>
                    <ConnectButton />
                </div>
            </nav>

            <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "100px 2rem 4rem" }}>

                {/* Header */}
                <div style={{ marginBottom: "2.5rem", display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
                    <div>
                        <div style={{ fontSize: ".65rem", fontFamily: "var(--mono)", color: "var(--muted)", letterSpacing: ".12em", textTransform: "uppercase", marginBottom: ".5rem" }}>Seller Dashboard</div>
                        <h1 style={{ fontSize: "clamp(1.5rem, 3vw, 2rem)", fontWeight: 900, letterSpacing: "-.04em", lineHeight: 1, marginBottom: ".5rem" }}>{shortAddr(address!)}</h1>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: isAvailable ? "var(--green)" : "var(--subtle)", boxShadow: isAvailable ? "0 0 8px var(--green)" : "none", transition: "all .3s" }} />
                            <span style={{ fontSize: ".78rem", color: "var(--muted)" }}>{isAvailable ? "Accepting orders" : "Not accepting orders"}</span>
                        </div>
                    </div>

                    {/* Go online/offline — shows spinner and "Pending…" while tx is in flight */}
                    <button
                        onClick={toggleAvailability}
                        disabled={pendingAvail}
                        style={{ background: isAvailable ? "rgba(62,207,142,.1)" : "var(--surface)", border: `1px solid ${isAvailable ? "rgba(62,207,142,.35)" : "var(--border2)"}`, borderRadius: "8px", color: isAvailable ? "var(--green)" : "var(--muted)", padding: ".75rem 1.5rem", fontSize: ".85rem", fontWeight: 700, fontFamily: "'Cabinet Grotesk', sans-serif", cursor: pendingAvail ? "not-allowed" : "pointer", opacity: pendingAvail ? 0.6 : 1, display: "flex", alignItems: "center", gap: "8px", transition: "all .2s" }}
                    >
                        {pendingAvail
                            ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />
                            : <Zap size={15} />
                        }
                        {pendingAvail ? "Pending…" : isAvailable ? "Go Offline" : "Go Online"}
                    </button>
                </div>

                {/* Stats — network reads from chain dynamically */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "1px", background: "var(--border)", borderRadius: "10px", overflow: "hidden", marginBottom: "2rem" }}>
                    {[
                        { label: "Zones configured", value: configuredZones.length.toString() },
                        { label: "Total orders", value: sellerOrders.length.toString() },
                        { label: "Status", value: isAvailable ? "Online" : "Offline" },
                        { label: "Network", value: chain?.name ?? "—" },
                    ].map(s => (
                        <div key={s.label} style={{ background: "var(--surface)", padding: "1.25rem", textAlign: "center" }}>
                            <div style={{ fontSize: "1.25rem", fontWeight: 900, letterSpacing: "-.04em", fontFamily: "'Cabinet Grotesk', sans-serif", marginBottom: ".25rem", color: s.label === "Status" ? (isAvailable ? "var(--green)" : "var(--muted)") : "var(--text)" }}>{s.value}</div>
                            <div style={{ fontSize: ".68rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>{s.label}</div>
                        </div>
                    ))}
                </div>

                {/* Tabs */}
                <div style={{ display: "flex", gap: "2px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "8px", padding: "3px", marginBottom: "2rem", width: "fit-content" }}>
                    {(["dashboard", "zones", "orders"] as const).map(t => (
                        <button key={t} onClick={() => setTab(t)} style={{ background: tab === t ? "var(--card2)" : "none", border: tab === t ? "1px solid var(--border2)" : "1px solid transparent", borderRadius: "6px", color: tab === t ? "var(--text)" : "var(--muted)", padding: ".55rem 1.25rem", fontSize: ".82rem", fontWeight: tab === t ? 700 : 400, fontFamily: "'Cabinet Grotesk', sans-serif", cursor: "pointer", textTransform: "capitalize", transition: "all .15s" }}>
                            {t}
                        </button>
                    ))}
                </div>

                {/* ── DASHBOARD TAB ─────────────────────────────────────────── */}
                {tab === "dashboard" && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                        <div style={{ gridColumn: "1 / -1", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", overflow: "hidden" }}>
                            <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid var(--border)", fontSize: ".85rem", fontWeight: 700 }}>Seller setup checklist</div>
                            <div style={{ padding: "1.25rem 1.5rem", display: "flex", flexDirection: "column", gap: ".875rem" }}>
                                {[
                                    { label: "Connect wallet", done: true },
                                    { label: "Set zone prices", done: configuredZones.length > 0 },
                                    { label: "Go online (setAvailability)", done: !!isAvailable },
                                    { label: "Receive first order", done: sellerOrders.length > 0 },
                                ].map(item => (
                                    <div key={item.label} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                                        <div style={{ width: "22px", height: "22px", borderRadius: "50%", background: item.done ? "rgba(62,207,142,.15)" : "var(--faint)", border: `1.5px solid ${item.done ? "rgba(62,207,142,.4)" : "var(--border2)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all .3s" }}>
                                            {item.done && <CheckCircle size={12} style={{ color: "var(--green)" }} />}
                                        </div>
                                        <span style={{ fontSize: ".85rem", color: item.done ? "var(--text)" : "var(--muted)", fontWeight: item.done ? 500 : 400 }}>{item.label}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", overflow: "hidden" }}>
                            <div style={{ padding: "1.1rem 1.5rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <div style={{ fontSize: ".85rem", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}><MapPin size={14} style={{ color: "var(--orange-text)" }} /> Active zones</div>
                                <button onClick={() => setTab("zones")} style={{ fontSize: ".7rem", color: "var(--orange-text)", background: "none", border: "none", cursor: "pointer", fontFamily: "'Cabinet Grotesk', sans-serif" }}>Manage →</button>
                            </div>
                            <div style={{ padding: "1rem" }}>
                                {configuredZones.length === 0 ? (
                                    <div style={{ padding: ".75rem", fontSize: ".8rem", color: "var(--muted)", textAlign: "center" }}>No zones configured yet</div>
                                ) : (
                                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                        {configuredZones.map(z => (
                                            <div key={z.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: ".65rem .75rem", background: "var(--faint)", borderRadius: "6px" }}>
                                                <span style={{ fontSize: ".82rem" }}>{z.name}</span>
                                                <span style={{ fontFamily: "var(--mono)", fontSize: ".78rem", color: "var(--orange-text)" }}>{formatUsdc(onChainPrices[z.key])}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", overflow: "hidden" }}>
                            <div style={{ padding: "1.1rem 1.5rem", borderBottom: "1px solid var(--border)", fontSize: ".85rem", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
                                <Package size={14} style={{ color: "var(--orange-text)" }} /> Delivery flow
                            </div>
                            <div style={{ padding: "1.5rem" }}>
                                {[
                                    { step: "1", text: "Deliver the package to the buyer" },
                                    { step: "2", text: "Go to Orders tab — your orders load automatically" },
                                    { step: "3", text: "Click Mark Delivered on the relevant order" },
                                    { step: "4", text: "Generate OTP — copy and send to buyer via SMS" },
                                    { step: "5", text: "Wait 2 hrs after buyer confirms → funds auto-release" },
                                ].map(s => (
                                    <div key={s.step} style={{ display: "flex", gap: "12px", marginBottom: ".875rem" }}>
                                        <div style={{ width: "22px", height: "22px", borderRadius: "50%", background: "var(--orange-glow)", border: "1px solid var(--orange-border)", color: "var(--orange-text)", fontSize: ".7rem", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{s.step}</div>
                                        <span style={{ fontSize: ".8rem", color: "var(--muted)", lineHeight: 1.6, paddingTop: "2px" }}>{s.text}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* ── ZONES TAB ─────────────────────────────────────────────── */}
                {tab === "zones" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                        <div style={{ fontSize: ".82rem", color: "var(--muted)", marginBottom: ".5rem" }}>
                            Set USDC prices per delivery zone. Prices are public on-chain — buyers see them when placing orders.
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "1px", background: "var(--border)", borderRadius: "10px", overflow: "hidden" }}>
                            {PRESET_ZONES.map(z => {
                                const onChain = onChainPrices[z.key]
                                const isSet = onChain && onChain > BigInt(0)
                                const isPending = pendingZone === z.key
                                return (
                                    <div key={z.key} style={{ background: "var(--surface)", padding: "1.5rem", borderBottom: "1px solid var(--border)" }}>
                                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1rem" }}>
                                            <div>
                                                <div style={{ fontWeight: 700, fontSize: ".92rem", marginBottom: ".2rem" }}>{z.name}</div>
                                                <div style={{ fontFamily: "var(--mono)", fontSize: ".65rem", color: "var(--subtle)" }}>{z.key}</div>
                                            </div>
                                            {isSet && (
                                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                                    <span style={{ fontFamily: "var(--mono)", fontSize: ".82rem", color: "var(--orange-text)", background: "var(--orange-glow)", border: "1px solid var(--orange-border)", borderRadius: "4px", padding: "2px 8px" }}>{formatUsdc(onChain)}</span>
                                                    <button onClick={() => removeZonePrice(z.key)} title="Remove zone" style={{ background: "none", border: "1px solid var(--border)", borderRadius: "5px", color: "var(--muted)", cursor: "pointer", width: "26px", height: "26px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                                        <Trash2 size={12} />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                        <div style={{ display: "flex", gap: "8px" }}>
                                            <div style={{ position: "relative", flex: 1 }}>
                                                <span style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", fontSize: ".82rem", color: "var(--muted)", fontFamily: "var(--mono)" }}>$</span>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    placeholder={isSet ? (Number(onChain) / 10 ** USDC_DECIMALS).toFixed(2) : "0.00"}
                                                    value={zonePrices[z.key] || ""}
                                                    onChange={e => setZonePrices(p => ({ ...p, [z.key]: e.target.value }))}
                                                    style={{ width: "100%", padding: ".6rem .75rem .6rem 1.75rem", background: "var(--faint)", border: "1px solid var(--border2)", borderRadius: "6px", color: "var(--text)", fontSize: ".85rem", fontFamily: "var(--mono)", outline: "none" }}
                                                />
                                            </div>
                                            <button
                                                onClick={() => setZonePrice(z.key)}
                                                disabled={isPending || !zonePrices[z.key]}
                                                style={{ background: "var(--orange)", color: "#fff", border: "none", borderRadius: "6px", padding: ".6rem 1rem", fontFamily: "'Cabinet Grotesk', sans-serif", fontSize: ".82rem", fontWeight: 700, cursor: isPending ? "not-allowed" : "pointer", opacity: isPending || !zonePrices[z.key] ? 0.6 : 1, display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap", transition: "opacity .2s" }}
                                            >
                                                {isPending
                                                    ? <><Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Pending…</>
                                                    : <><Plus size={13} /> {isSet ? "Update" : "Set"}</>
                                                }
                                            </button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )}

                {/* ── ORDERS TAB ───────────────────────────────────────────── */}
                {tab === "orders" && (
                    <div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
                            <div style={{ fontSize: ".82rem", color: "var(--muted)" }}>
                                All orders placed against your address, fetched from on-chain events.
                            </div>
                            <button
                                onClick={fetchSellerOrders}
                                disabled={loadingOrders}
                                style={{ background: "none", border: "1px solid var(--border2)", borderRadius: "6px", color: "var(--muted)", cursor: loadingOrders ? "not-allowed" : "pointer", padding: ".5rem .875rem", fontSize: ".78rem", fontFamily: "'Cabinet Grotesk', sans-serif", display: "flex", alignItems: "center", gap: "6px", opacity: loadingOrders ? 0.6 : 1 }}
                            >
                                {loadingOrders
                                    ? <><Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Fetching…</>
                                    : <><RefreshCw size={13} /> Refresh</>
                                }
                            </button>
                        </div>

                        {/* Show full loading screen only on first load, not on refresh */}
                        {loadingOrders && sellerOrders.length === 0 ? (
                            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "3rem", textAlign: "center" }}>
                                <Loader2 size={24} style={{ color: "var(--subtle)", margin: "0 auto 1rem", animation: "spin 1s linear infinite" }} />
                                <div style={{ fontSize: ".85rem", color: "var(--muted)" }}>Fetching your orders from chain…</div>
                            </div>
                        ) : sellerOrders.length === 0 ? (
                            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "3rem", textAlign: "center" }}>
                                <Clock size={32} style={{ color: "var(--subtle)", margin: "0 auto 1rem" }} />
                                <div style={{ fontSize: ".92rem", fontWeight: 600, marginBottom: ".5rem" }}>No orders yet</div>
                                <div style={{ fontSize: ".8rem", color: "var(--muted)" }}>Orders placed against your address will appear here</div>
                            </div>
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: "1px", background: "var(--border)", borderRadius: "10px", overflow: "hidden" }}>
                                <div style={{ background: "var(--faint)", padding: ".75rem 1.5rem", display: "grid", gridTemplateColumns: "70px 1fr 90px 100px 110px 150px", gap: "1rem", fontSize: ".65rem", fontFamily: "var(--mono)", color: "var(--subtle)", letterSpacing: ".08em", textTransform: "uppercase" }}>
                                    <span>ID</span><span>Buyer</span><span>Zone</span><span>Amount</span><span>Status</span><span>Action</span>
                                </div>
                                {sellerOrders.map(order => {
                                    const statusLabel = ORDER_STATUS[order.status as keyof typeof ORDER_STATUS] ?? "Unknown"
                                    const isFunded = order.status === 0
                                    const zoneLabel = PRESET_ZONES.find(z => encodeZone(z.key) === order.zone)?.name ?? shortAddr(order.zone)
                                    const statusColors: Record<string, string> = {
                                        Funded: "#F0A500", Delivered: "var(--orange-text)", Completed: "var(--green)",
                                        Released: "var(--green)", Refunded: "var(--muted)", Disputed: "var(--red)",
                                    }
                                    const color = statusColors[statusLabel] ?? "var(--muted)"
                                    return (
                                        <div key={order.id} style={{ background: "var(--surface)", padding: ".875rem 1.5rem", display: "grid", gridTemplateColumns: "70px 1fr 90px 100px 110px 150px", gap: "1rem", alignItems: "center", fontSize: ".82rem" }}>
                                            <span style={{ fontFamily: "var(--mono)", color: "var(--muted)" }}>#{order.id}</span>
                                            <span style={{ fontFamily: "var(--mono)", fontSize: ".75rem", color: "var(--text)" }}>{shortAddr(order.buyer)}</span>
                                            <span style={{ fontFamily: "var(--mono)", fontSize: ".75rem", color: "var(--subtle)" }}>{zoneLabel}</span>
                                            <span style={{ fontFamily: "var(--mono)", fontSize: ".78rem", color: "var(--orange-text)" }}>{formatUsdc(order.usdcAmount)}</span>
                                            <span style={{ fontSize: ".72rem", background: `${color}18`, border: `1px solid ${color}44`, color, borderRadius: "4px", padding: "2px 8px", textAlign: "center", fontFamily: "var(--mono)" }}>{statusLabel}</span>
                                            {isFunded ? (
                                                <button onClick={() => setOtpModal(order.id)} style={{ background: "var(--orange)", color: "#fff", border: "none", borderRadius: "6px", padding: ".5rem .875rem", fontSize: ".75rem", fontWeight: 700, cursor: "pointer", fontFamily: "'Cabinet Grotesk', sans-serif", display: "flex", alignItems: "center", gap: "5px" }}>
                                                    <Package size={12} /> Mark Delivered
                                                </button>
                                            ) : (
                                                <span style={{ fontSize: ".72rem", color: "var(--subtle)", fontFamily: "var(--mono)" }}>—</span>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                )}

            </div>

            {otpModal !== null && (
                <OTPModal
                    orderId={otpModal}
                    onClose={() => setOtpModal(null)}
                    onConfirm={(hash, _otp) => handleMarkDelivered(otpModal, hash)}
                />
            )}

            {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

            <div style={{ textAlign: "center", padding: "2rem", borderTop: "1px solid var(--border)" }}>
                <a href={`https://sepolia.basescan.org/address/${ESCROW_CONTRACT_ADDRESS}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: ".72rem", color: "var(--subtle)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "6px", fontFamily: "var(--mono)" }}>
                    {ESCROW_CONTRACT_ADDRESS} <ExternalLink size={11} />
                </a>
            </div>
        </main>
    )
}

// ─── Shared styles ────────────────────────────────────────────────────────────

function Style() {
    return (
        <style>{`
      @import url('https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@400,500,700,800,900&f[]=satoshi@400,500,700&display=swap');
      @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap');
      *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
      :root{
        --bg:#0C0C0B;--surface:#141412;--card:#1B1A17;--card2:#201F1B;
        --border:#252420;--border2:#2E2D29;--text:#F0EDE6;--muted:#7A7872;
        --subtle:#3A3935;--faint:#1F1E1B;
        --orange:#F05A1A;--orange-glow:rgba(240,90,26,0.15);--orange-border:rgba(240,90,26,0.28);--orange-text:#F26B30;
        --green:#3ECF8E;--red:#E05252;--amber:#F0A500;
        --mono:'JetBrains Mono',monospace;
      }
      html{scroll-behavior:smooth}
      body{-webkit-font-smoothing:antialiased}
      input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none}
      input:focus{border-color:var(--orange)!important;outline:none}
      @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
      @keyframes spin{to{transform:rotate(360deg)}}
      .dp-nav{position:fixed;top:0;left:0;right:0;z-index:200;display:flex;align-items:center;justify-content:space-between;padding:0 2.5rem;height:64px;background:rgba(12,12,11,0.88);backdrop-filter:blur(20px);border-bottom:1px solid var(--border)}
      .dp-logo{display:flex;align-items:center;gap:10px;text-decoration:none}
      .dp-logo-mark{width:30px;height:30px;background:var(--orange);border-radius:7px;display:flex;align-items:center;justify-content:center;font-family:'Cabinet Grotesk',sans-serif;font-size:14px;font-weight:900;color:#fff;flex-shrink:0}
      .dp-logo-text{font-family:'Cabinet Grotesk',sans-serif;font-size:1rem;font-weight:800;color:var(--text);letter-spacing:-.02em}
      .dp-nav-right{display:flex;align-items:center;gap:1rem}
      .dp-btn-primary{background:var(--orange);color:#fff;border:none;padding:.875rem 2rem;border-radius:6px;font-family:'Cabinet Grotesk',sans-serif;font-size:.92rem;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:transform .2s,box-shadow .2s;letter-spacing:-.01em;text-decoration:none}
      .dp-btn-primary:hover{transform:translateY(-2px);box-shadow:0 10px 32px rgba(240,90,26,.35)}
      .dp-btn-primary:disabled{opacity:0.6;cursor:not-allowed;transform:none;box-shadow:none}
    `}</style>
    )
}
