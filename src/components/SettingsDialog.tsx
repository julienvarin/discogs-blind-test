import { Dialog } from "@plexui/ui/components/Dialog";
import { Switch } from "@plexui/ui/components/Switch";
import { Slider } from "@plexui/ui/components/Slider";
import { Button } from "@plexui/ui/components/Button";
import { DEFAULT_SETTINGS, useSettings } from "../lib/settings";
import { FIELD_LABEL, FIELDS } from "../lib/types";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-tertiary">{title}</h3>
      {children}
    </section>
  );
}

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [s, set] = useSettings();
  const noSource = !s.useApple && !s.useYoutube;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Dialog.Content width={520}>
        <Dialog.Header>
          <Dialog.Title>Settings</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <div className="flex flex-col gap-7 pb-2">
            <Section title="Song sources">
              <Switch
                checked={s.useApple}
                onCheckedChange={(v) => set({ useApple: v })}
                label="Apple Music previews"
                description="30-second previews matched by artist and title."
              />
              <Switch
                checked={s.useYoutube}
                onCheckedChange={(v) => set({ useYoutube: v })}
                label="YouTube videos from Discogs"
                description="Uses the videos attached to each release on Discogs."
              />
              {noSource && <p className="text-sm text-danger">Turn on at least one source to play.</p>}
              <p className="text-xs text-tertiary">Releases with no playable source are always skipped.</p>
              <Slider
                label="YouTube start point"
                range
                min={0}
                max={80}
                step={5}
                unit="%"
                value={[s.ytStartMinPct, s.ytStartMaxPct]}
                onChange={([a, b]) => set({ ytStartMinPct: a, ytStartMaxPct: b })}
              />
            </Section>

            <Section title="Which releases">
              <Switch
                checked={s.excludeCDs}
                onCheckedChange={(v) => set({ excludeCDs: v })}
                label="Exclude CDs"
                description="A vinyl that comes with a bonus CD still counts as vinyl."
              />
              <Switch
                checked={s.excludeBigCompilations}
                onCheckedChange={(v) => set({ excludeBigCompilations: v })}
                label="Exclude big compilations"
                description={`Compilations or Various Artists releases with more than ${s.compilationMaxTracks} tracks.`}
              />
              {s.excludeBigCompilations && (
                <Slider
                  label="Max tracks for a compilation"
                  min={4}
                  max={40}
                  step={1}
                  value={s.compilationMaxTracks}
                  resetValue={DEFAULT_SETTINGS.compilationMaxTracks}
                  onChange={(v) => set({ compilationMaxTracks: v })}
                />
              )}
            </Section>

            <Section title="Points">
              {FIELDS.map((f) => (
                <Slider
                  key={f}
                  label={FIELD_LABEL[f]}
                  min={0}
                  max={10}
                  step={1}
                  unit=" pts"
                  value={s.points[f]}
                  resetValue={DEFAULT_SETTINGS.points[f]}
                  onChange={(v) => set({ points: { ...s.points, [f]: v } })}
                />
              ))}
              <Slider
                label="Bonus for all four"
                min={0}
                max={10}
                step={1}
                unit=" pts"
                value={s.allFourBonus}
                resetValue={DEFAULT_SETTINGS.allFourBonus}
                onChange={(v) => set({ allFourBonus: v })}
              />
            </Section>

            <Section title="Timer & rules">
              <Slider
                label="Full-points window"
                min={10}
                max={120}
                step={5}
                unit="s"
                value={s.timerSeconds}
                resetValue={DEFAULT_SETTINGS.timerSeconds}
                onChange={(v) => set({ timerSeconds: v })}
              />
              <Slider
                label="Points after the timer"
                min={0}
                max={100}
                step={10}
                unit="%"
                value={Math.round(s.latePointsFactor * 100)}
                resetValue={DEFAULT_SETTINGS.latePointsFactor * 100}
                onChange={(v) => set({ latePointsFactor: v / 100 })}
              />
              <Slider
                label="Wrong guesses allowed per field"
                min={1}
                max={10}
                step={1}
                value={s.maxWrongPerField}
                resetValue={DEFAULT_SETTINGS.maxWrongPerField}
                onChange={(v) => set({ maxWrongPerField: v })}
              />
            </Section>
          </div>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" color="secondary" onClick={() => set({ ...DEFAULT_SETTINGS })}>
            Reset defaults
          </Button>
          <Button color="primary" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
