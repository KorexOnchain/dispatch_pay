const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("dp_token");
}

async function safeJson(res: Response) {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      `Expected JSON from ${res.url} but got ${res.status} ${res.statusText}. ` +
      `Check that NEXT_PUBLIC_API_URL is set correctly (currently: "${API_URL}").`
    );
  }
  return res.json();
}

export async function getNonce(address: string): Promise<string> {
  const res = await fetch(`${API_URL}/auth/nonce/${address}`);
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.error ?? "Failed to get nonce");
  return data.nonce;
}

export async function verifySignature(address: string, signature: string): Promise<string> {
  const res = await fetch(`${API_URL}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, signature }),
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.error ?? "Signature verification failed");
  localStorage.setItem("dp_token", data.token);
  return data.token;
}

export async function getMe() {
  const token = getToken();
  const res = await fetch(`${API_URL}/user/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return safeJson(res);
}

export async function registerUser(name: string, phone: string, role: "BUYER" | "SELLER") {
  const token = getToken();
  const res = await fetch(`${API_URL}/user/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, phone, role }),
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.error ?? "Registration failed");
  return data.user;
}

export async function createOrder(
  onchainId: string,
  sellerAddress: string,
  amount: string,
  txHash: string
) {
  const token = getToken();
  const res = await fetch(`${API_URL}/order/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ onchainId, sellerAddress, amount, txHash }),
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.error ?? "Failed to create order");
  return data.order;
}

export async function getMyOrders() {
  const token = getToken();
  const res = await fetch(`${API_URL}/order/mine`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.error ?? "Failed to fetch orders");
  return data.orders;
}

export async function generateOtp(orderId: string) {
  const token = getToken();
  const res = await fetch(`${API_URL}/order/${orderId}/generate-otp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.error ?? "Failed to generate OTP");
  return data.otp;
}

export async function verifyOtp(orderId: string, otp: string) {
  const token = getToken();
  const res = await fetch(`${API_URL}/order/${orderId}/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ otp }),
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.error ?? "OTP verification failed");
  return data;
}
