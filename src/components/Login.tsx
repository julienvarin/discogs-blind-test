import { useState } from "react";
import { Button } from "@plexui/ui/components/Button";
import { Input } from "@plexui/ui/components/Input";
import { saveToken, verifyToken, type Identity } from "../lib/auth";

export function Login({ onLogin }: { onLogin: (id: Identity) => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const id = await verifyToken(token);
      saveToken(token);
      onLogin(id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-4 py-12">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="text-6xl">💿</div>
        <h1 className="heading-2xl">Crate</h1>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Input
          size="xl"
          pill
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Discogs token"
          autoComplete="off"
          invalid={Boolean(error)}
        />
        {error && <p className="text-center text-sm text-danger">{error}</p>}
        <Button type="submit" color="primary" size="xl" block pill loading={loading} disabled={token.trim().length < 10}>
          Connect
        </Button>
        <a
          className="text-center text-sm text-tertiary underline-offset-4 hover:underline"
          href="https://www.discogs.com/settings/developers"
          target="_blank"
          rel="noreferrer"
        >
          Get a token ↗
        </a>
      </form>
    </div>
  );
}
