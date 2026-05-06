"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { registerUser } from "@/lib/api"

export function RegisterModal({ onSuccess }: { onSuccess: (user: any) => void }) {
    const [name, setName] = useState("")
    const [phone, setPhone] = useState("")
    const [role, setRole] = useState<"BUYER" | "SELLER">("BUYER")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState("")

    const handleSubmit = async () => {
        if (!name || !phone) { setError("All fields are required"); return }
        setLoading(true)
        try {
            const user = await registerUser(name, phone, role)
            onSuccess(user)
        } catch (e: any) {
            setError(e.message || "Registration failed")
        } finally {
            setLoading(false)
        }
    }

    return (
        <div style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(12,12,11,0.9)", backdropFilter: "blur(16px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
            <div style={{ background: "var(--card)", border: "1px solid var(--border2)", borderRadius: "16px", width: "100%", maxWidth: "420px", overflow: "hidden" }}>
                <div style={{ padding: "1.5rem 1.75rem", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ fontSize: ".65rem", fontFamily: "var(--mono)", color: "var(--muted)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: ".3rem" }}>One time setup</div>
                    <div style={{ fontSize: "1.05rem", fontWeight: 800, fontFamily: "'Cabinet Grotesk', sans-serif" }}>Complete your profile</div>
                </div>

                <div style={{ padding: "1.75rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
                    <div>
                        <label style={{ fontSize: ".72rem", fontFamily: "var(--mono)", color: "var(--muted)", letterSpacing: ".06em", textTransform: "uppercase", display: "block", marginBottom: ".5rem" }}>Full name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="John Doe"
                            style={{ width: "100%", padding: ".75rem 1rem", background: "var(--faint)", border: "1px solid var(--border2)", borderRadius: "8px", color: "var(--text)", fontSize: ".85rem", outline: "none", fontFamily: "'Cabinet Grotesk', sans-serif" }}
                        />
                    </div>

                    <div>
                        <label style={{ fontSize: ".72rem", fontFamily: "var(--mono)", color: "var(--muted)", letterSpacing: ".06em", textTransform: "uppercase", display: "block", marginBottom: ".5rem" }}>Phone number</label>
                        <input
                            type="tel"
                            value={phone}
                            onChange={e => setPhone(e.target.value)}
                            placeholder="+234 800 000 0000"
                            style={{ width: "100%", padding: ".75rem 1rem", background: "var(--faint)", border: "1px solid var(--border2)", borderRadius: "8px", color: "var(--text)", fontSize: ".85rem", outline: "none", fontFamily: "'Cabinet Grotesk', sans-serif" }}
                        />
                    </div>

                    <div>
                        <label style={{ fontSize: ".72rem", fontFamily: "var(--mono)", color: "var(--muted)", letterSpacing: ".06em", textTransform: "uppercase", display: "block", marginBottom: ".5rem" }}>I am a</label>
                        <div style={{ display: "flex", gap: "8px" }}>
                            {(["BUYER", "SELLER"] as const).map(r => (
                                <button
                                    key={r}
                                    onClick={() => setRole(r)}
                                    style={{ flex: 1, padding: ".75rem", background: role === r ? "var(--orange-glow)" : "var(--faint)", border: `1.5px solid ${role === r ? "var(--orange)" : "var(--border2)"}`, borderRadius: "8px", color: role === r ? "var(--orange-text)" : "var(--muted)", fontFamily: "'Cabinet Grotesk', sans-serif", fontSize: ".85rem", fontWeight: role === r ? 700 : 400, cursor: "pointer", transition: "all .15s" }}
                                >
                                    {r === "BUYER" ? "Buyer" : "Seller"}
                                </button>
                            ))}
                        </div>
                    </div>

                    {error && <div style={{ fontSize: ".78rem", color: "var(--red)" }}>{error}</div>}

                    <button
                        onClick={handleSubmit}
                        disabled={loading}
                        className="dp-btn-primary"
                        style={{ justifyContent: "center", opacity: loading ? 0.6 : 1 }}
                    >
                        {loading ? <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Saving…</> : "Continue"}
                    </button>
                </div>
            </div>
        </div>
    )
}