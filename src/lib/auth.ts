// Personal access token login. The token never leaves the browser except to api.discogs.com.
const KEY = "dbt:discogs-token";

export const getToken = () => {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
};

export type Identity = { username: string; id: number };

export async function verifyToken(token: string): Promise<Identity> {
  const res = await fetch(`https://api.discogs.com/oauth/identity?token=${encodeURIComponent(token.trim())}`);
  if (res.status === 401) throw new Error("Discogs rejected this token.");
  if (!res.ok) throw new Error(`Discogs error ${res.status}. Try again in a minute.`);
  return (await res.json()) as Identity;
}

export const saveToken = (token: string) => localStorage.setItem(KEY, token.trim());
export const clearToken = () => localStorage.removeItem(KEY);
