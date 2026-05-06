import { useAccount, useSignMessage } from "wagmi";
import { useEffect, useState } from "react";
import { getNonce, verifySignature, getMe, getToken } from "./api";

export function useAuth() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    if (!isConnected || !address) {
      setUser(null);
      setAuthenticated(false);
      return;
    }
    checkAuth();
  }, [isConnected, address]);

  const checkAuth = async () => {
    const token = getToken();
    if (!token) return;
    const me = await getMe();
    if (me?.user) {
      setUser(me.user);
      setAuthenticated(true);
    }
  };

  const login = async () => {
    if (!address) return;
    setLoading(true);
    try {
      const nonce = await getNonce(address);
      const message = `Sign in to DispatchPay\nNonce: ${nonce}`;
      const signature = await signMessageAsync({ message, account: address });
      await verifySignature(address, signature);
      const me = await getMe();
      if (me?.user) {
        setUser(me.user);
        setAuthenticated(true);
      }
    } catch (e) {
      console.error("Login failed", e);
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem("dp_token");
    setUser(null);
    setAuthenticated(false);
  };

 return { user, setUser, loading, authenticated, login, logout };
}