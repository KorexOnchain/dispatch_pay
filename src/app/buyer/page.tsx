"use client"

import { useAuth } from "@/lib/useAuth";
import { RegisterModal } from "@/components/RegisterModal"
import { createOrder, getMyOrders } from "@/lib/api";
import { ConnectButton } from "@rainbow-me/rainbowkit"
import Link from "next/link"
import { useState, useEffect, useCallback, useRef } from "react"
import {
    ArrowLeft,
    Zap,
    Package,
    CheckCircle,
    Clock,
    ExternalLink,
    RefreshCw,
    Loader2,
    ShieldCheck,
    AlertTriangle,
    Lock,
    ArrowRight,
    Hash,
    Check,
} from "lucide-react"
import {
    useAccount,
    useWriteContract,
    useWaitForTransactionReceipt,
    usePublicClient,
    useConfig,
} from "wagmi"
import { encodeZone, ESCROW_ABI, ESCROW_CONTRACT_ADDRESS, ORDER_STATUS } from "@/constants"
import { ERC20_ABI as USDC_ABI, USDC_ADDRESS } from "@/constants"

// ─── Types ────────────────────────────────────────────────────────────────────

type SellerInfo = {
    address: string
    available: boolean
    zones: { key: string; name: string; price: bigint }[]
}

type BuyerOrder = {
    id: number
    seller: string
    zone: string
    usdcAmount: bigint
    status: number
    createdAt: bigint
    confirmedAt: bigint
    deliveredAt: bigint
    chainNow: number
}

type ToastState = { msg: string; type: "success" | "error" | "info" } | null

// ─── Constants ────────────────────────────────────────────────────────────────

const USDC_DECIMALS = 6

const PRESET_ZONES = [
    { name: "Lekki", key: "lekki" },
    { name: "Victoria Island", key: "vi" },
    { name: "Ikoyi", key: "ikoyi" },
    { name: "Surulere", key: "surulere" },
    { name: "Ikeja", key: "ikeja" },
    { name: "Yaba", key: "yaba" },
    { name: "Ajah", key: "ajah" },
    { name: "Festac", key: "festac" },
]

// ─── Utils ────────────────────────────────────────────────────────────────────

function shortAddr(addr: string) {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function formatUsdc(val: bigint) {
    return `$${(Number(val) / 10 ** USDC_DECIMALS).toFixed(2)}`
}

function timeAgo(ts: bigint) {
    const diff = Math.floor(Date.now() / 1000) - Number(ts)
    if (diff < 60) return `${diff}s ago`
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ msg, type, onClose }: { msg: string; type: "success" | "error" | "info"; onClose: () => void }) {
    useEffect(() => {
        const t = setTimeout(onClose, 4500)
        return () => clearTimeout(t)
    }, [onClose])
    const colors = { success: "var(--green)", error: "var(--red)", info: "var(--orange-text)" }
    return (
        <div style={{ position: "fixed", bottom: "2rem", right: "2rem", zIndex: 9999, background: "var(--card)", border: `1px solid ${colors[type]}`, borderRadius: "10px", padding: ".875rem 1.25rem", display: "flex", alignItems: "center", gap: "10px", fontSize: ".82rem", color: "var(--text)", maxWidth: "360px", boxShadow: "0 8px 40px rgba(0,0,0,.5)", animation: "fadeUp .3s ease both" }}>
            <span style={{ color: colors[type], fontSize: "1.1rem" }}>{type === "success" ? "✓" : type === "error" ? "✕" : "·"}</span>
            {msg}
            <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: "1.1rem" }}>×</button>
        </div>
    )
}

// ─── OTP Confirm Modal ────────────────────────────────────────────────────────

function OTPConfirmModal({ orderId, attemptsUsed, onClose, onSubmit }: {
    orderId: number
    attemptsUsed: number
    onClose: () => void
    onSubmit: (otp: string) => Promise<void>
}) {
    const [submitting, setSubmitting] = useState(false)
    const attemptsLeft = 4 - attemptsUsed
    const inputs = useRef<(HTMLInputElement | null)[]>([])
    const [digits, setDigits] = useState(["", "", "", "", "", ""])

    const handleDigit = (i: number, val: string) => {
        if (!/^\d?$/.test(val)) return
        const next = [...digits]
        next[i] = val
        setDigits(next)
        if (val && i < 5) inputs.current[i + 1]?.focus()
        if (!val && i > 0) inputs.current[i - 1]?.focus()
    }

    const handlePaste = (e: React.ClipboardEvent) => {
        const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6)
        if (pasted.length === 6) {
            setDigits(pasted.split(""))
            inputs.current[5]?.focus()
        }
    }

    const fullOtp = digits.join("")

    const handleSubmit = async () => {
        if (fullOtp.length !== 6) return
        setSubmitting(true)
        try { await onSubmit(fullOtp) }
        finally { setSubmitting(false) }
    }

    return (
        <div style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(12,12,11,0.9)", backdropFilter: "blur(16px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
            <div style={{ background: "var(--card)", border: "1px solid var(--border2)", borderRadius: "16px", width: "100%", maxWidth: "420px", overflow: "hidden", animation: "fadeUp .3s ease" }}>
                <div style={{ padding: "1.5rem 1.75rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                        <div style={{ fontSize: ".65rem", fontFamily: "var(--mono)", color: "var(--muted)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: ".3rem" }}>Order #{orderId}</div>
                        <div style={{ fontSize: "1.05rem", fontWeight: 800, fontFamily: "'Cabinet Grotesk', sans-serif", letterSpacing: "-.02em" }}>Enter OTP</div>
                    </div>
                    <button onClick={onClose} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--muted)", cursor: "pointer", width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem" }}>×</button>
                </div>
                <div style={{ padding: "1.75rem" }}>
                    <p style={{ fontSize: ".82rem", color: "var(--muted)", lineHeight: 1.75, marginBottom: "1.75rem" }}>
                        Enter the 6-digit code the seller sent you via SMS. You have{" "}
                        <strong style={{ color: attemptsLeft <= 1 ? "var(--red)" : "var(--text)" }}>{attemptsLeft} attempt{attemptsLeft !== 1 ? "s" : ""}</strong> remaining.
                    </p>
                    <div style={{ display: "flex", gap: "8px", justifyContent: "center", marginBottom: "1.5rem" }} onPaste={handlePaste}>
                        {digits.map((d, i) => (
                            <input
                                key={i}
                                ref={el => { inputs.current[i] = el }}
                                type="text"
                                inputMode="numeric"
                                maxLength={1}
                                value={d}
                                onChange={e => handleDigit(i, e.target.value)}
                                onKeyDown={e => { if (e.key === "Backspace" && !d && i > 0) inputs.current[i - 1]?.focus() }}
                                style={{ width: "52px", height: "62px", textAlign: "center", background: "var(--surface)", border: `1.5px solid ${d ? "var(--orange)" : "var(--border2)"}`, borderRadius: "8px", color: "var(--text)", fontSize: "1.5rem", fontFamily: "var(--mono)", fontWeight: 700, outline: "none", transition: "border-color .15s", caretColor: "var(--orange)" }}
                            />
                        ))}
                    </div>
                    <div style={{ display: "flex", justifyContent: "center", gap: "6px", marginBottom: "1.75rem" }}>
                        {[0, 1, 2, 3].map(i => (
                            <div key={i} style={{ width: "10px", height: "10px", borderRadius: "50%", background: i < attemptsUsed ? "var(--red)" : "var(--border2)", border: `1px solid ${i < attemptsUsed ? "var(--red)" : "var(--border)"}`, transition: "all .2s" }} />
                        ))}
                    </div>
                    <button
                        onClick={handleSubmit}
                        disabled={fullOtp.length !== 6 || submitting}
                        className="dp-btn-primary"
                        style={{ width: "100%", justifyContent: "center", opacity: fullOtp.length !== 6 || submitting ? 0.6 : 1 }}
                    >
                        {submitting
                            ? <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Verifying on-chain…</>
                            : <><Check size={16} /> Confirm Delivery</>
                        }
                    </button>
                </div>
            </div>
        </div>
    )
}

// ─── Dispute Modal ────────────────────────────────────────────────────────────

function DisputeModal({ orderId, onClose, onConfirm }: { orderId: number; onClose: () => void; onConfirm: () => Promise<void> }) {
    const [submitting, setSubmitting] = useState(false)
    const handleConfirm = async () => {
        setSubmitting(true)
        try { await onConfirm() } finally { setSubmitting(false) }
    }
    return (
        <div style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(12,12,11,0.9)", backdropFilter: "blur(16px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
            <div style={{ background: "var(--card)", border: "1px solid rgba(224,82,82,.3)", borderRadius: "16px", width: "100%", maxWidth: "400px", overflow: "hidden", animation: "fadeUp .3s ease" }}>
                <div style={{ padding: "1.5rem 1.75rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: "rgba(224,82,82,.1)", border: "1px solid rgba(224,82,82,.3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <AlertTriangle size={15} style={{ color: "var(--red)" }} />
                    </div>
                    <div style={{ fontSize: "1rem", fontWeight: 800, fontFamily: "'Cabinet Grotesk', sans-serif" }}>Raise Dispute</div>
                    <button onClick={onClose} style={{ marginLeft: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--muted)", cursor: "pointer", width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem" }}>×</button>
                </div>
                <div style={{ padding: "1.75rem" }}>
                    <p style={{ fontSize: ".82rem", color: "var(--muted)", lineHeight: 1.8, marginBottom: "1.5rem" }}>
                        You&apos;re raising a dispute for order <strong style={{ color: "var(--text)" }}>#{orderId}</strong>. Funds will be frozen and the contract owner will investigate. This is irreversible.
                    </p>
                    <div style={{ display: "flex", gap: "8px" }}>
                        <button onClick={onClose} style={{ flex: 1, background: "none", border: "1px solid var(--border2)", borderRadius: "6px", color: "var(--muted)", padding: ".75rem", cursor: "pointer", fontFamily: "'Cabinet Grotesk', sans-serif", fontSize: ".85rem", fontWeight: 500 }}>Cancel</button>
                        <button onClick={handleConfirm} disabled={submitting} style={{ flex: 1, background: "var(--red)", border: "none", borderRadius: "6px", color: "#fff", padding: ".75rem", cursor: submitting ? "not-allowed" : "pointer", fontFamily: "'Cabinet Grotesk', sans-serif", fontSize: ".85rem", fontWeight: 700, opacity: submitting ? 0.7 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                            {submitting ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Submitting…</> : "Confirm Dispute"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

// ─── Order Card ───────────────────────────────────────────────────────────────

function OrderCard({ order, onOtp, onDispute, onRelease, onRefund }: {
    order: BuyerOrder
    onOtp: (id: number) => void
    onDispute: (id: number) => void
    onRelease: (id: number, unlocked: boolean) => void
    onRefund: (id: number) => void
}) {
    const statusLabel = ORDER_STATUS[order.status as keyof typeof ORDER_STATUS] ?? "Unknown"
    const zoneLabel = PRESET_ZONES.find(z => encodeZone(z.key) === order.zone)?.name ?? shortAddr(order.zone)
    const statusColors: Record<string, string> = {
        Funded: "#F0A500", Delivered: "var(--orange-text)", Completed: "var(--green)",
        Released: "var(--green)", Refunded: "var(--muted)", Disputed: "var(--red)",
    }
    const color = statusColors[statusLabel] ?? "var(--muted)"

    const isDelivered = order.status === 1
    const isCompleted = order.status === 2 && Number(order.confirmedAt) > 0
    const isFunded = order.status === 0

    const [disputeSecsLeft, setDisputeSecsLeft] = useState<number>(() => {
        if (order.status !== 2 || Number(order.confirmedAt) === 0) return 0
        const deadline = Number(order.confirmedAt) + 7200
        const remaining = deadline - order.chainNow  // CHANGED
        return remaining > 0 ? remaining : 0
    })

    useEffect(() => {
        if (order.status !== 2 || Number(order.confirmedAt) === 0) return
        const deadline = Number(order.confirmedAt) + 7200
        const remaining = deadline - order.chainNow  // CHANGED
        if (remaining <= 0) {
            setDisputeSecsLeft(0)
            return
        }
        setDisputeSecsLeft(remaining)
        const id = setInterval(() => {
            setDisputeSecsLeft(prev => Math.max(0, prev - 1))
        }, 1000)
        return () => clearInterval(id)
    }, [order.status, order.confirmedAt, order.chainNow])
    const fmtCountdown = (s: number) => {
        const m = Math.floor(s / 60); const sec = s % 60
        return `${m}m ${sec.toString().padStart(2, "0")}s`
    }

    console.log("Order", order.id, {
        status: order.status,
        confirmedAt: Number(order.confirmedAt),
        disputeSecsLeft,
        now: Math.floor(Date.now() / 1000),
        deadline: Number(order.confirmedAt) + 7200,
    })

    // Only show Release Funds if: completed + confirmedAt set + 2hrs elapsed
    const canDispute = isCompleted && disputeSecsLeft > 0
    const canRelease = isCompleted && Number(order.confirmedAt) > 0  // always show after OTP
    const releaseUnlocked = isCompleted && disputeSecsLeft === 0 && Number(order.confirmedAt) > 0

    return (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", overflow: "hidden", transition: "border-color .2s" }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--border2)")}
            onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border)")}
        >
            <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontFamily: "var(--mono)", fontSize: ".72rem", color: "var(--subtle)" }}>#{order.id}</span>
                    <span style={{ fontSize: ".72rem", background: `${color}18`, border: `1px solid ${color}44`, color, borderRadius: "4px", padding: "2px 10px", fontFamily: "var(--mono)" }}>{statusLabel}</span>
                </div>
                <span style={{ fontSize: ".72rem", color: "var(--subtle)", fontFamily: "var(--mono)" }}>{timeAgo(order.createdAt)}</span>
            </div>
            <div style={{ padding: "1.25rem" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: ".75rem", marginBottom: "1.25rem" }}>
                    <div>
                        <div style={{ fontSize: ".62rem", fontFamily: "var(--mono)", color: "var(--subtle)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: ".3rem" }}>Seller</div>
                        <div style={{ fontFamily: "var(--mono)", fontSize: ".78rem", color: "var(--text)" }}>{shortAddr(order.seller)}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: ".62rem", fontFamily: "var(--mono)", color: "var(--subtle)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: ".3rem" }}>Zone</div>
                        <div style={{ fontSize: ".82rem", fontWeight: 600 }}>{zoneLabel}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: ".62rem", fontFamily: "var(--mono)", color: "var(--subtle)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: ".3rem" }}>Amount</div>
                        <div style={{ fontFamily: "var(--mono)", fontSize: ".85rem", color: "var(--orange-text)", fontWeight: 700 }}>{formatUsdc(order.usdcAmount)}</div>
                    </div>
                </div>

                {canDispute && (
                    <div style={{ background: "rgba(62,207,142,.06)", border: "1px solid rgba(62,207,142,.18)", borderRadius: "8px", padding: ".75rem 1rem", display: "flex", alignItems: "center", gap: "8px", marginBottom: "1rem" }}>
                        <Clock size={13} style={{ color: "var(--green)", flexShrink: 0 }} />
                        <span style={{ fontSize: ".78rem", color: "var(--muted)" }}>Dispute window closes in{" "}<strong style={{ color: "var(--green)", fontFamily: "var(--mono)" }}>{fmtCountdown(disputeSecsLeft)}</strong></span>
                    </div>
                )}
                {canRelease && !releaseUnlocked && (
                    <div style={{ background: "rgba(240,90,26,.06)", border: "1px solid var(--orange-border)", borderRadius: "8px", padding: ".75rem 1rem", display: "flex", alignItems: "center", gap: "8px", marginBottom: "1rem" }}>
                        <Clock size={13} style={{ color: "var(--orange-text)", flexShrink: 0 }} />
                        <span style={{ fontSize: ".78rem", color: "var(--muted)" }}>
                            Funds locked for dispute window — releases in{" "}
                            <strong style={{ color: "var(--orange-text)", fontFamily: "var(--mono)" }}>{fmtCountdown(disputeSecsLeft)}</strong>
                        </span>
                    </div>
                )}
                {releaseUnlocked && (
                    <div style={{ background: "rgba(62,207,142,.06)", border: "1px solid rgba(62,207,142,.2)", borderRadius: "8px", padding: ".75rem 1rem", display: "flex", alignItems: "center", gap: "8px", marginBottom: "1rem" }}>
                        <Zap size={13} style={{ color: "var(--green)", flexShrink: 0 }} />
                        <span style={{ fontSize: ".78rem", color: "var(--muted)" }}>Dispute window closed. Funds can now be released to seller.</span>
                    </div>
                )}

                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    {isDelivered && (
                        <button onClick={() => onOtp(order.id)} className="dp-btn-primary" style={{ fontSize: ".82rem", padding: ".6rem 1.25rem" }}>
                            <Hash size={14} /> Enter OTP
                        </button>
                    )}
                    {canDispute && (
                        <button onClick={() => onDispute(order.id)} style={{ background: "rgba(224,82,82,.1)", border: "1px solid rgba(224,82,82,.3)", borderRadius: "6px", color: "var(--red)", padding: ".6rem 1.25rem", fontSize: ".82rem", fontWeight: 600, cursor: "pointer", fontFamily: "'Cabinet Grotesk', sans-serif", display: "flex", alignItems: "center", gap: "6px" }}>
                            <AlertTriangle size={14} /> Dispute
                        </button>
                    )}
                    {canRelease && (
                        <button
                            onClick={() => onRelease(order.id, releaseUnlocked)}
                            style={{
                                background: releaseUnlocked ? "rgba(62,207,142,.1)" : "rgba(120,120,120,.1)",
                                border: `1px solid ${releaseUnlocked ? "rgba(62,207,142,.3)" : "var(--border2)"}`,
                                borderRadius: "6px",
                                color: releaseUnlocked ? "var(--green)" : "var(--muted)",
                                padding: ".6rem 1.25rem",
                                fontSize: ".82rem",
                                fontWeight: 600,
                                cursor: "pointer",
                                fontFamily: "'Cabinet Grotesk', sans-serif",
                                display: "flex",
                                alignItems: "center",
                                gap: "6px"
                            }}
                        >
                            <Zap size={14} />
                            {releaseUnlocked ? "Release Funds" : `Release in ${fmtCountdown(disputeSecsLeft)}`}
                        </button>
                    )}
                    {isFunded && (
                        <button onClick={() => onRefund(order.id)} style={{ background: "none", border: "1px solid var(--border2)", borderRadius: "6px", color: "var(--muted)", padding: ".6rem 1.25rem", fontSize: ".78rem", cursor: "pointer", fontFamily: "'Cabinet Grotesk', sans-serif", display: "flex", alignItems: "center", gap: "6px" }}>
                            <RefreshCw size={13} /> Claim Refund
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}

// ─── Place Order Panel ────────────────────────────────────────────────────────

function PlaceOrderPanel({ address, chain, onSuccess }: { address: string; chain: any; onSuccess: () => void }) {
    useConfig()
    const { writeContractAsync } = useWriteContract()
    const publicClient = usePublicClient()

    const [sellerAddr, setSellerAddr] = useState("")
    const [sellerInfo, setSellerInfo] = useState<SellerInfo | null>(null)
    const [lookingUp, setLookingUp] = useState(false)
    const [selectedZone, setSelectedZone] = useState<string | null>(null)
    const [step, setStep] = useState<"lookup" | "zone" | "approve" | "order">("lookup")
    const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
    const [toast, setToast] = useState<ToastState>(null)
    const [pending, setPending] = useState(false)

    const showToast = (msg: string, type: "success" | "error" | "info" = "info") => setToast({ msg, type })

    const selectedZoneData = sellerInfo?.zones.find(z => z.key === selectedZone)

    const { isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash })

    // ── Handle transaction confirmation ──────────────────────────────────────
    useEffect(() => {
        if (!txSuccess) return
        showToast("Transaction confirmed ✓", "success")
        setPending(false)

        if (step === "approve") {
            setTxHash(undefined)
            setStep("order")
            return
        }

        if (step === "order") {
            ; (async () => {
                try {
                    const receipt = await publicClient!.getTransactionReceipt({ hash: txHash! })
                    const raw = receipt.logs[receipt.logs.length - 1] as any
                    if (raw) {
                        const orderId = Number(BigInt(raw.topics[1]))
                        await createOrder(
                            orderId.toString(),
                            sellerInfo!.address,
                            selectedZoneData!.price.toString(),
                            txHash!
                        )
                    }
                } catch (e) {
                    console.error("Failed to save order", e)
                }
                setTxHash(undefined)
                setStep("lookup")
                setSellerAddr("")
                setSellerInfo(null)
                setSelectedZone(null)
                onSuccess()
            })()
        }
    }, [txSuccess, step]) // eslint-disable-line react-hooks/exhaustive-deps

    const lookupSeller = async () => {
        if (!sellerAddr || !sellerAddr.startsWith("0x") || sellerAddr.length !== 42) {
            showToast("Enter a valid seller address", "error"); return
        }
        setLookingUp(true)
        try {
            const available = await (publicClient!.readContract as any)({
                address: ESCROW_CONTRACT_ADDRESS,
                abi: ESCROW_ABI,
                functionName: "sellerAvailable",
                args: [sellerAddr as `0x${string}`],
            })
            const zones: SellerInfo["zones"] = []
            await Promise.all(
                PRESET_ZONES.map(async z => {
                    const price = await (publicClient!.readContract as any)({
                        address: ESCROW_CONTRACT_ADDRESS,
                        abi: ESCROW_ABI,
                        functionName: "getPrice",
                        args: [sellerAddr as `0x${string}`, encodeZone(z.key)],
                    })
                    if (price > BigInt(0)) zones.push({ key: z.key, name: z.name, price })
                })
            )
            setSellerInfo({ address: sellerAddr, available, zones })
            setStep("zone")
        } catch (e) {
            showToast("Failed to look up seller. Check the address.", "error")
        } finally {
            setLookingUp(false)
        }
    }

    const handleApprove = async () => {
        if (!selectedZoneData) return
        setPending(true)
        try {
            const hash = await writeContractAsync({
                address: USDC_ADDRESS,
                abi: USDC_ABI,
                functionName: "approve",
                args: [ESCROW_CONTRACT_ADDRESS, selectedZoneData.price],
                chain,
                account: address as `0x${string}`,
            })
            setTxHash(hash)
            showToast("Approving USDC spend…", "info")
        } catch (e: any) {
            setPending(false)
            showToast(e?.message?.slice(0, 80) || "Approval failed", "error")
        }
    }

    const handlePlaceOrder = async () => {
        if (!selectedZoneData || !sellerInfo) return
        setPending(true)
        try {
            const hash = await writeContractAsync({
                address: ESCROW_CONTRACT_ADDRESS,
                abi: ESCROW_ABI,
                functionName: "createOrder",
                args: [sellerInfo.address as `0x${string}`, encodeZone(selectedZoneData.key)],
                chain,
                account: address as `0x${string}`,
                gas: BigInt(500000),
            })
            setTxHash(hash)
            showToast("Placing order on-chain…", "info")
        } catch (e: any) {
            setPending(false)
            showToast(e?.message?.slice(0, 80) || "Order failed", "error")
        }
    }

    return (
        <>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "14px", overflow: "hidden" }}>
                <div style={{ padding: "1.5rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "12px" }}>
                    <div style={{ width: "38px", height: "38px", background: "var(--orange-glow)", border: "1px solid var(--orange-border)", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Lock size={16} style={{ color: "var(--orange-text)" }} />
                    </div>
                    <div>
                        <div style={{ fontSize: ".65rem", fontFamily: "var(--mono)", color: "var(--muted)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: ".2rem" }}>New Escrow Order</div>
                        <div style={{ fontSize: ".95rem", fontWeight: 800, fontFamily: "'Cabinet Grotesk', sans-serif", letterSpacing: "-.02em" }}>Place a delivery order</div>
                    </div>
                </div>

                {/* Progress steps */}
                <div style={{ display: "flex", padding: "1rem 1.5rem", borderBottom: "1px solid var(--border)", gap: 0, overflowX: "auto" }}>
                    {[
                        { key: "lookup", label: "Find seller" },
                        { key: "zone", label: "Pick zone" },
                        { key: "approve", label: "Approve USDC" },
                        { key: "order", label: "Place order" },
                    ].map((s, i) => {
                        const steps = ["lookup", "zone", "approve", "order"]
                        const currentIdx = steps.indexOf(step)
                        const sIdx = steps.indexOf(s.key)
                        const done = sIdx < currentIdx
                        const active = s.key === step
                        return (
                            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 0, flexShrink: 0 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                    <div style={{ width: "24px", height: "24px", borderRadius: "50%", background: done ? "rgba(62,207,142,.15)" : active ? "var(--orange-glow)" : "var(--faint)", border: `1.5px solid ${done ? "rgba(62,207,142,.4)" : active ? "var(--orange-border)" : "var(--border)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: ".65rem", fontWeight: 700, color: done ? "var(--green)" : active ? "var(--orange-text)" : "var(--subtle)", fontFamily: "var(--mono)", transition: "all .3s" }}>
                                        {done ? "✓" : i + 1}
                                    </div>
                                    <span style={{ fontSize: ".72rem", color: active ? "var(--text)" : "var(--muted)", fontWeight: active ? 600 : 400, whiteSpace: "nowrap" }}>{s.label}</span>
                                </div>
                                {i < 3 && <span style={{ color: "var(--subtle)", fontSize: ".7rem", padding: "0 .75rem" }}>→</span>}
                            </div>
                        )
                    })}
                </div>

                <div style={{ padding: "1.75rem" }}>
                    {/* STEP: LOOKUP */}
                    {step === "lookup" && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                            <div>
                                <label style={{ fontSize: ".72rem", fontFamily: "var(--mono)", color: "var(--muted)", letterSpacing: ".06em", textTransform: "uppercase", display: "block", marginBottom: ".5rem" }}>Seller wallet address</label>
                                <div style={{ display: "flex", gap: "8px" }}>
                                    <input
                                        type="text"
                                        value={sellerAddr}
                                        onChange={e => setSellerAddr(e.target.value)}
                                        placeholder="0x…"
                                        style={{ flex: 1, padding: ".75rem 1rem", background: "var(--faint)", border: "1px solid var(--border2)", borderRadius: "8px", color: "var(--text)", fontSize: ".85rem", fontFamily: "var(--mono)", outline: "none" }}
                                        onKeyDown={e => e.key === "Enter" && lookupSeller()}
                                    />
                                    <button onClick={lookupSeller} disabled={lookingUp} className="dp-btn-primary" style={{ padding: ".75rem 1.25rem", fontSize: ".85rem" }}>
                                        {lookingUp ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <ArrowRight size={15} />}
                                    </button>
                                </div>
                            </div>
                            <div style={{ background: "var(--faint)", border: "1px solid var(--border)", borderRadius: "8px", padding: "1rem", fontSize: ".78rem", color: "var(--muted)", lineHeight: 1.7 }}>
                                <strong style={{ color: "var(--text)" }}>How it works:</strong> Enter your seller&apos;s wallet address. We&apos;ll read their zones and prices directly from the contract — no trust needed.
                            </div>
                        </div>
                    )}

                    {/* STEP: ZONE */}
                    {step === "zone" && sellerInfo && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                            <div style={{ background: sellerInfo.available ? "rgba(62,207,142,.06)" : "rgba(224,82,82,.06)", border: `1px solid ${sellerInfo.available ? "rgba(62,207,142,.2)" : "rgba(224,82,82,.2)"}`, borderRadius: "8px", padding: "1rem 1.25rem", display: "flex", alignItems: "center", gap: "10px" }}>
                                <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: sellerInfo.available ? "var(--green)" : "var(--red)", boxShadow: sellerInfo.available ? "0 0 8px var(--green)" : "none", flexShrink: 0 }} />
                                <div>
                                    <div style={{ fontSize: ".82rem", fontWeight: 600, marginBottom: ".15rem" }}>{shortAddr(sellerInfo.address)}</div>
                                    <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>{sellerInfo.available ? `Accepting orders · ${sellerInfo.zones.length} zone${sellerInfo.zones.length !== 1 ? "s" : ""} active` : "Not currently accepting orders"}</div>
                                </div>
                                <button onClick={() => { setStep("lookup"); setSellerInfo(null) }} style={{ marginLeft: "auto", background: "none", border: "1px solid var(--border)", borderRadius: "5px", color: "var(--muted)", cursor: "pointer", padding: ".3rem .6rem", fontSize: ".72rem", fontFamily: "'Cabinet Grotesk', sans-serif" }}>Change</button>
                            </div>

                            {!sellerInfo.available && (
                                <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)", fontSize: ".85rem" }}>This seller is currently offline. Try another seller.</div>
                            )}
                            {sellerInfo.available && sellerInfo.zones.length === 0 && (
                                <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)", fontSize: ".85rem" }}>This seller has no zones configured yet.</div>
                            )}
                            {sellerInfo.available && sellerInfo.zones.length > 0 && (
                                <>
                                    <div>
                                        <label style={{ fontSize: ".72rem", fontFamily: "var(--mono)", color: "var(--muted)", letterSpacing: ".06em", textTransform: "uppercase", display: "block", marginBottom: ".75rem" }}>Select your delivery zone</label>
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                                            {sellerInfo.zones.map(z => (
                                                <button
                                                    key={z.key}
                                                    onClick={() => setSelectedZone(z.key)}
                                                    style={{ background: selectedZone === z.key ? "var(--orange-glow)" : "var(--faint)", border: `1.5px solid ${selectedZone === z.key ? "var(--orange)" : "var(--border2)"}`, borderRadius: "10px", padding: "1rem", textAlign: "left", cursor: "pointer", transition: "all .15s" }}
                                                >
                                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: ".3rem" }}>
                                                        <span style={{ fontSize: ".85rem", fontWeight: 600, color: "var(--text)" }}>{z.name}</span>
                                                        {selectedZone === z.key && <Check size={14} style={{ color: "var(--orange-text)" }} />}
                                                    </div>
                                                    <div style={{ fontFamily: "var(--mono)", fontSize: ".88rem", fontWeight: 700, color: selectedZone === z.key ? "var(--orange-text)" : "var(--muted)" }}>{formatUsdc(z.price)}</div>
                                                    <div style={{ fontFamily: "var(--mono)", fontSize: ".62rem", color: "var(--subtle)", marginTop: ".25rem" }}>{z.key}</div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    {selectedZoneData && (
                                        <div style={{ background: "var(--faint)", border: "1px solid var(--border2)", borderRadius: "10px", padding: "1rem 1.25rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                            <div style={{ fontSize: ".82rem", color: "var(--muted)" }}>
                                                <div style={{ marginBottom: ".2rem" }}>You&apos;ll lock <strong style={{ color: "var(--text)" }}>{formatUsdc(selectedZoneData.price)} USDC</strong> in escrow</div>
                                                <div style={{ fontSize: ".72rem" }}>Released to seller only after you confirm delivery</div>
                                            </div>
                                            <Lock size={16} style={{ color: "var(--orange-text)", flexShrink: 0 }} />
                                        </div>
                                    )}
                                    <button onClick={() => setStep("approve")} disabled={!selectedZone} className="dp-btn-primary" style={{ justifyContent: "center", opacity: !selectedZone ? 0.5 : 1 }}>
                                        Continue <ArrowRight size={14} />
                                    </button>
                                </>
                            )}
                        </div>
                    )}

                    {/* STEP: APPROVE */}
                    {step === "approve" && selectedZoneData && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                            <div style={{ background: "var(--faint)", border: "1px solid var(--border2)", borderRadius: "10px", padding: "1.25rem" }}>
                                <div style={{ fontSize: ".68rem", fontFamily: "var(--mono)", color: "var(--subtle)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: ".75rem" }}>Order summary</div>
                                {[
                                    { label: "Seller", val: shortAddr(sellerInfo!.address) },
                                    { label: "Zone", val: selectedZoneData.name },
                                    { label: "Amount", val: formatUsdc(selectedZoneData.price) + " USDC" },
                                ].map(r => (
                                    <div key={r.label} style={{ display: "flex", justifyContent: "space-between", marginBottom: ".6rem", fontSize: ".82rem" }}>
                                        <span style={{ color: "var(--muted)" }}>{r.label}</span>
                                        <span style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>{r.val}</span>
                                    </div>
                                ))}
                            </div>
                            <div style={{ background: "rgba(240,90,26,.06)", border: "1px solid var(--orange-border)", borderRadius: "8px", padding: ".875rem 1rem", fontSize: ".78rem", color: "var(--muted)", lineHeight: 1.7 }}>
                                First you need to approve the escrow contract to spend your USDC. This is a standard ERC-20 approval — no funds move yet.
                            </div>
                            <button onClick={handleApprove} disabled={pending} className="dp-btn-primary" style={{ justifyContent: "center", opacity: pending ? 0.6 : 1 }}>
                                {pending ? <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Approving…</> : <>Approve {formatUsdc(selectedZoneData.price)} USDC</>}
                            </button>
                        </div>
                    )}

                    {/* STEP: ORDER */}
                    {step === "order" && selectedZoneData && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                            <div style={{ background: "rgba(62,207,142,.06)", border: "1px solid rgba(62,207,142,.2)", borderRadius: "8px", padding: ".875rem 1rem", display: "flex", alignItems: "center", gap: "8px", fontSize: ".82rem", color: "var(--green)" }}>
                                <CheckCircle size={15} /> USDC approved. Ready to lock funds in escrow.
                            </div>
                            <div style={{ background: "var(--faint)", border: "1px solid var(--border2)", borderRadius: "10px", padding: "1.25rem" }}>
                                {[
                                    { label: "Seller", val: shortAddr(sellerInfo!.address) },
                                    { label: "Zone", val: selectedZoneData.name },
                                    { label: "Escrow amount", val: formatUsdc(selectedZoneData.price) + " USDC" },
                                    { label: "Platform fee", val: "$0.00" },
                                ].map(r => (
                                    <div key={r.label} style={{ display: "flex", justifyContent: "space-between", marginBottom: ".6rem", fontSize: ".82rem" }}>
                                        <span style={{ color: "var(--muted)" }}>{r.label}</span>
                                        <span style={{ fontFamily: "var(--mono)", fontWeight: 600, color: r.label === "Platform fee" ? "var(--green)" : "var(--text)" }}>{r.val}</span>
                                    </div>
                                ))}
                            </div>
                            <button onClick={handlePlaceOrder} disabled={pending} className="dp-btn-primary" style={{ justifyContent: "center", opacity: pending ? 0.6 : 1 }}>
                                {pending ? <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Placing order…</> : <><Lock size={16} /> Lock funds & Place Order</>}
                            </button>
                        </div>
                    )}
                </div>
            </div>
            {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
        </>
    )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BuyerPage() {
    useConfig()
    const { address, isConnected, chain } = useAccount()
    const { writeContractAsync } = useWriteContract()
    const publicClient = usePublicClient()
    const { user, setUser, authenticated, login, loading: authLoading } = useAuth()

    const [toast, setToast] = useState<ToastState>(null)
    const [tab, setTab] = useState<"order" | "orders">("order")
    const [buyerOrders, setBuyerOrders] = useState<BuyerOrder[]>([])
    const [loadingOrders, setLoadingOrders] = useState(false)
    const [otpModal, setOtpModal] = useState<number | null>(null)
    const [disputeModal, setDisputeModal] = useState<number | null>(null)
    const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
    const [otpAttempts, setOtpAttempts] = useState<Record<number, number>>({})

    const { isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash })

    const showToast = useCallback((msg: string, type: "success" | "error" | "info" = "info") => setToast({ msg, type }), [])

    // Single txSuccess handler for main page (OTP, dispute, release, refund)
    useEffect(() => {
        if (!txSuccess) return
        showToast("Transaction confirmed on-chain ✓", "success")
        setTxHash(undefined)
        setTimeout(() => fetchBuyerOrders(), 3000)
    }, [txSuccess]) // eslint-disable-line react-hooks/exhaustive-deps

    const fetchBuyerOrders = useCallback(async () => {
        if (!address || !publicClient) return
        setLoadingOrders(true)
        try {
            const backendOrders = await getMyOrders()
            if (backendOrders.length === 0) { setLoadingOrders(false); return }

            const block = await publicClient.getBlock()  // ADD THIS
            const chainNow = Number(block.timestamp)      // ADD THIS

            const orders = await Promise.all(
                backendOrders.map(async (backendOrder: any) => {
                    try {
                        const order = await publicClient.readContract({
                            address: ESCROW_CONTRACT_ADDRESS,
                            abi: ESCROW_ABI,
                            functionName: "getOrder",
                            args: [BigInt(backendOrder.onchainId)],
                        } as any) as any

                        const attempts = await publicClient.readContract({
                            address: ESCROW_CONTRACT_ADDRESS,
                            abi: ESCROW_ABI,
                            functionName: "otpAttempts",
                            args: [BigInt(backendOrder.onchainId)],
                        } as any) as number

                        setOtpAttempts(p => ({ ...p, [backendOrder.onchainId]: attempts }))

                        return {
                            id: Number(backendOrder.onchainId),
                            seller: order.seller as string,
                            zone: order.zone as string,
                            usdcAmount: order.usdcAmount as bigint,
                            status: Number(order.status),
                            createdAt: order.createdAt as bigint,
                            confirmedAt: order.confirmedAt as bigint,
                            deliveredAt: order.deliveredAt as bigint,
                            chainNow,  // ADD THIS
                        } satisfies BuyerOrder
                    } catch { return null }
                })
            )

            const valid = orders.filter((o): o is BuyerOrder => o !== null)
            setBuyerOrders(valid.sort((a, b) => b.id - a.id))
        } catch (e) {
            showToast("Failed to fetch orders", "error")
        } finally {
            setLoadingOrders(false)
        }
    }, [address, publicClient, showToast])
    useEffect(() => {
        if (tab === "orders") fetchBuyerOrders()
    }, [tab, fetchBuyerOrders])

    const handleOtpSubmit = async (orderId: number, otp: string) => {
        try {
            const hash = await writeContractAsync({
                address: ESCROW_CONTRACT_ADDRESS,
                abi: ESCROW_ABI,
                functionName: "confirmDelivery",
                args: [BigInt(orderId), otp],
                chain,
                account: address,
                gas: BigInt(300000),
            })
            setTxHash(hash)
            setOtpModal(null)
            showToast(`OTP submitted for order #${orderId}`, "info")
        } catch (e: any) {
            showToast(e?.message?.slice(0, 80) || "OTP submission failed", "error")
            throw e
        }
    }

    const handleDispute = async (orderId: number) => {
        try {
            const hash = await writeContractAsync({
                address: ESCROW_CONTRACT_ADDRESS,
                abi: ESCROW_ABI,
                functionName: "disputeOrder",
                args: [BigInt(orderId)],
                chain,
                account: address,
            })
            setTxHash(hash)
            setDisputeModal(null)
            showToast(`Dispute raised for order #${orderId}`, "info")
        } catch (e: any) {
            showToast(e?.message?.slice(0, 80) || "Dispute failed", "error")
            throw e
        }
    }

    const handleRelease = async (orderId: number, unlocked: boolean) => {
        if (!unlocked) {
            showToast("Funds are still locked — dispute window hasn't closed yet", "error")
            return  // never opens MetaMask
        }
        try {
            const hash = await writeContractAsync({
                address: ESCROW_CONTRACT_ADDRESS,
                abi: ESCROW_ABI,
                functionName: "releaseFunds",
                args: [BigInt(orderId)],
                chain,
                account: address,
                gas: BigInt(200000),
            })
            setTxHash(hash)
            showToast(`Releasing funds for order #${orderId}…`, "info")
        } catch (e: any) {
            showToast(e?.message?.slice(0, 80) || "Release failed", "error")
        }
    }
    const handleRefund = async (orderId: number) => {
        try {
            const hash = await writeContractAsync({
                address: ESCROW_CONTRACT_ADDRESS,
                abi: ESCROW_ABI,
                functionName: "claimRefund",
                args: [BigInt(orderId)],
                chain,
                account: address,
            })
            setTxHash(hash)
            showToast(`Refund claimed for order #${orderId}`, "info")
        } catch (e: any) {
            showToast(e?.message?.slice(0, 80) || "Refund failed", "error")
        }
    }

    // ── Not connected ──────────────────────────────────────────────────────────
    if (!isConnected) {
        return (
            <main style={{ fontFamily: "'Cabinet Grotesk', 'Satoshi', sans-serif", background: "#0C0C0B", color: "#F0EDE6", minHeight: "100vh" }}>
                <Style />
                <nav className="dp-nav">
                    <Link className="dp-logo" href="/"><div className="dp-logo-mark">D</div><span className="dp-logo-text">DispatchPay</span></Link>
                    <div className="dp-nav-right"><ConnectButton /></div>
                </nav>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", flexDirection: "column", gap: "1.5rem", padding: "2rem", textAlign: "center" }}>
                    <div style={{ width: "64px", height: "64px", background: "var(--orange-glow)", border: "1px solid var(--orange-border)", borderRadius: "16px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <ShieldCheck size={28} style={{ color: "var(--orange-text)" }} />
                    </div>
                    <div>
                        <div style={{ fontSize: "1.4rem", fontWeight: 900, letterSpacing: "-.04em", marginBottom: ".5rem", fontFamily: "'Cabinet Grotesk', sans-serif" }}>Connect to place an order</div>
                        <div style={{ fontSize: ".88rem", color: "var(--muted)", maxWidth: "320px" }}>Your funds are escrowed on-chain until you confirm delivery. No middleman.</div>
                    </div>
                    <ConnectButton />
                    <div style={{ display: "flex", gap: "2rem", marginTop: "1rem" }}>
                        {[{ v: "$0", l: "Platform fee" }, { v: "2 hr", l: "Dispute window" }, { v: "7 days", l: "Refund guarantee" }].map(s => (
                            <div key={s.l} style={{ textAlign: "center" }}>
                                <div style={{ fontSize: "1.1rem", fontWeight: 900, fontFamily: "'Cabinet Grotesk', sans-serif", letterSpacing: "-.03em" }}>{s.v}</div>
                                <div style={{ fontSize: ".68rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>{s.l}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </main>
        )
    }

    // ── Not authenticated ──────────────────────────────────────────────────────
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
        )
    }

    // ── Registration ───────────────────────────────────────────────────────────
    if (authenticated && !user?.name) {
        return (
            <>
                <Style />
                <RegisterModal onSuccess={(u) => setUser(u)} />
            </>
        )
    }

    // ── Connected ──────────────────────────────────────────────────────────────
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

            <div style={{ maxWidth: "960px", margin: "0 auto", padding: "100px 2rem 4rem" }}>
                <div style={{ marginBottom: "2.5rem" }}>
                    <div style={{ fontSize: ".65rem", fontFamily: "var(--mono)", color: "var(--muted)", letterSpacing: ".12em", textTransform: "uppercase", marginBottom: ".5rem" }}>Buyer Dashboard</div>
                    <h1 style={{ fontSize: "clamp(1.5rem, 3vw, 2.1rem)", fontWeight: 900, letterSpacing: "-.04em", lineHeight: 1, marginBottom: ".5rem", fontFamily: "'Cabinet Grotesk', sans-serif" }}>
                        Place & track orders
                    </h1>
                    <div style={{ fontSize: ".82rem", color: "var(--muted)" }}>Funds locked on-chain · released only when you confirm delivery</div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "1px", background: "var(--border)", borderRadius: "10px", overflow: "hidden", marginBottom: "2rem" }}>
                    {[
                        { label: "Total orders", value: buyerOrders.length.toString() },
                        { label: "Active", value: buyerOrders.filter(o => o.status < 3).length.toString() },
                        { label: "Completed", value: buyerOrders.filter(o => o.status === 3).length.toString() },
                        { label: "Network", value: chain?.name ?? "—" },
                    ].map(s => (
                        <div key={s.label} style={{ background: "var(--surface)", padding: "1.25rem", textAlign: "center" }}>
                            <div style={{ fontSize: "1.25rem", fontWeight: 900, letterSpacing: "-.04em", fontFamily: "'Cabinet Grotesk', sans-serif", marginBottom: ".25rem" }}>{s.value}</div>
                            <div style={{ fontSize: ".68rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>{s.label}</div>
                        </div>
                    ))}
                </div>

                <div style={{ display: "flex", gap: "2px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "8px", padding: "3px", marginBottom: "2rem", width: "fit-content" }}>
                    {(["order", "orders"] as const).map(t => (
                        <button key={t} onClick={() => setTab(t)} style={{ background: tab === t ? "var(--card2)" : "none", border: tab === t ? "1px solid var(--border2)" : "1px solid transparent", borderRadius: "6px", color: tab === t ? "var(--text)" : "var(--muted)", padding: ".55rem 1.5rem", fontSize: ".82rem", fontWeight: tab === t ? 700 : 400, fontFamily: "'Cabinet Grotesk', sans-serif", cursor: "pointer", transition: "all .15s", textTransform: t === "order" ? "none" : "capitalize" }}>
                            {t === "order" ? "Place Order" : "My Orders"}
                        </button>
                    ))}
                </div>

                {tab === "order" && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "1.5rem", alignItems: "start" }}>
                        <PlaceOrderPanel address={address!} chain={chain} onSuccess={() => { setTab("orders"); fetchBuyerOrders() }} />
                        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", overflow: "hidden" }}>
                                <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)", fontSize: ".82rem", fontWeight: 700 }}>Your protections</div>
                                <div style={{ padding: "1rem 1.25rem", display: "flex", flexDirection: "column", gap: ".875rem" }}>
                                    {[
                                        { icon: <ShieldCheck size={13} />, title: "OTP verification", desc: "Only you can release funds with your code" },
                                        { icon: <AlertTriangle size={13} />, title: "2-hr dispute window", desc: "Raise a dispute after confirming delivery" },
                                        { icon: <RefreshCw size={13} />, title: "7-day refund", desc: "Claim back if seller never delivers" },
                                        { icon: <Lock size={13} />, title: "Non-custodial", desc: "Only the contract holds your funds" },
                                    ].map(p => (
                                        <div key={p.title} style={{ display: "flex", gap: "10px" }}>
                                            <div style={{ width: "26px", height: "26px", borderRadius: "6px", background: "var(--orange-glow)", border: "1px solid var(--orange-border)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--orange-text)", flexShrink: 0, marginTop: "1px" }}>{p.icon}</div>
                                            <div>
                                                <div style={{ fontSize: ".78rem", fontWeight: 600, marginBottom: ".15rem" }}>{p.title}</div>
                                                <div style={{ fontSize: ".72rem", color: "var(--muted)", lineHeight: 1.5 }}>{p.desc}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", overflow: "hidden" }}>
                                <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)", fontSize: ".82rem", fontWeight: 700 }}>What happens next</div>
                                <div style={{ padding: "1rem 1.25rem", display: "flex", flexDirection: "column", gap: ".75rem" }}>
                                    {[
                                        "Funds locked in escrow on-chain",
                                        "Seller delivers to your address",
                                        "Seller sends you a 6-digit OTP",
                                        "You enter OTP to confirm receipt",
                                        "2-hr window → funds release to seller",
                                    ].map((s, i) => (
                                        <div key={i} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                                            <div style={{ width: "20px", height: "20px", borderRadius: "50%", background: "var(--faint)", border: "1px solid var(--border)", color: "var(--subtle)", fontSize: ".65rem", fontFamily: "var(--mono)", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: "1px" }}>{i + 1}</div>
                                            <span style={{ fontSize: ".78rem", color: "var(--muted)", lineHeight: 1.5 }}>{s}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {tab === "orders" && (
                    <div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
                            <div style={{ fontSize: ".82rem", color: "var(--muted)" }}>All orders you&apos;ve placed, read from on-chain.</div>
                            <button onClick={fetchBuyerOrders} disabled={loadingOrders} style={{ background: "none", border: "1px solid var(--border2)", borderRadius: "6px", color: "var(--muted)", cursor: loadingOrders ? "not-allowed" : "pointer", padding: ".5rem .875rem", fontSize: ".78rem", fontFamily: "'Cabinet Grotesk', sans-serif", display: "flex", alignItems: "center", gap: "6px", opacity: loadingOrders ? 0.6 : 1 }}>
                                {loadingOrders ? <><Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Fetching…</> : <><RefreshCw size={13} /> Refresh</>}
                            </button>
                        </div>

                        {loadingOrders && buyerOrders.length === 0 ? (
                            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "3rem", textAlign: "center" }}>
                                <Loader2 size={24} style={{ color: "var(--subtle)", margin: "0 auto 1rem", animation: "spin 1s linear infinite" }} />
                                <div style={{ fontSize: ".85rem", color: "var(--muted)" }}>Fetching your orders from chain…</div>
                            </div>
                        ) : buyerOrders.length === 0 ? (
                            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "4rem 2rem", textAlign: "center" }}>
                                <Package size={36} style={{ color: "var(--subtle)", margin: "0 auto 1.25rem" }} />
                                <div style={{ fontSize: ".95rem", fontWeight: 700, marginBottom: ".5rem" }}>No orders yet</div>
                                <div style={{ fontSize: ".82rem", color: "var(--muted)", marginBottom: "1.5rem" }}>Place your first escrow-backed delivery order</div>
                                <button onClick={() => setTab("order")} className="dp-btn-primary" style={{ margin: "0 auto" }}>
                                    Place an order <ArrowRight size={14} />
                                </button>
                            </div>
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                                {buyerOrders.map(order => (
                                    <OrderCard
                                        key={order.id}
                                        order={order}
                                        onOtp={id => setOtpModal(id)}
                                        onDispute={id => setDisputeModal(id)}
                                        onRelease={handleRelease}
                                        onRefund={handleRefund}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {otpModal !== null && (
                <OTPConfirmModal
                    orderId={otpModal}
                    attemptsUsed={otpAttempts[otpModal] ?? 0}
                    onClose={() => setOtpModal(null)}
                    onSubmit={(otp) => handleOtpSubmit(otpModal, otp)}
                />
            )}

            {disputeModal !== null && (
                <DisputeModal
                    orderId={disputeModal}
                    onClose={() => setDisputeModal(null)}
                    onConfirm={() => handleDispute(disputeModal)}
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
      @media(max-width:860px){
        .dp-nav{padding:0 1.25rem}
        [style*="gridTemplateColumns: 1fr 320px"]{grid-template-columns:1fr!important}
        [style*="repeat(4,1fr)"]{grid-template-columns:repeat(2,1fr)!important}
      }
    `}</style>
    )
}
