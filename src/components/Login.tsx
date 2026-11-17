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
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-4 py-12">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="text-6xl">💿</div>
        <h1 className="heading-2xl">Crate Blind Test</h1>
        <p className="text-secondary">
          Guess the track, artist, label and record from your own Discogs collection.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-subtle bg-surface-secondary p-6">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Discogs personal access token</span>
          <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste your token"
            autoComplete="off"
            invalid={Boolean(error)}
          />
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" color="primary" block pill loading={loading} disabled={token.trim().length < 10}>
          Connect my collection
        </Button>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-tertiary">
          <li>
            Open{" "}
            <a className="text-primary underline" href="https://www.discogs.com/settings/developers" target="_blank" rel="noreferrer">
              discogs.com/settings/developers
            </a>
          </li>
          <li>Click "Generate new token" and copy it.</li>
          <li>Paste it above. It's kept only in this browser.</li>
        </ol>
      </form>
    </div>
  );
}
