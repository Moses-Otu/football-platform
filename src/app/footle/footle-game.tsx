"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ageOn, shareText, type AgeHint, type GuessFeedback, type Match } from "@/lib/footle/clues";
import type { FootleState } from "@/lib/footle/data";
import { cn } from "@/lib/utils";

import { submitGuess } from "./actions";

interface Option {
  id: string;
  name: string;
  club: string | null;
}

/** Lowercase without accents, so "odegaard" finds "Ødegaard" and "Sá" finds "Sa". */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ø/gi, "o")
    .replace(/æ/gi, "ae")
    .toLowerCase();

const TILE_STYLE: Record<Match, string> = {
  match: "border-emerald-600 bg-emerald-600 text-white",
  miss: "border-border bg-muted text-foreground",
  unknown: "border-dashed border-border text-muted-foreground",
};

function Tile({ label, value, tone }: { label: string; value: string; tone: Match }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5 rounded-md border px-2 py-1.5", TILE_STYLE[tone])}>
      <span className="text-[0.65rem] font-medium tracking-wide uppercase opacity-75">{label}</span>
      <span className="truncate text-sm font-medium" title={value}>
        {value}
      </span>
    </div>
  );
}

const AGE_LABEL: Record<AgeHint, string> = {
  match: "",
  older: " ↑",
  younger: " ↓",
  unknown: "",
};

function GuessRow({ g }: { g: GuessFeedback }) {
  const ageTone: Match = g.ageHint === "match" ? "match" : g.ageHint === "unknown" ? "unknown" : "miss";
  return (
    <li className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{g.player.name}</span>
        {g.correct && <span className="text-sm font-medium text-emerald-600">Correct</span>}
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <Tile label="Club" value={g.player.club ?? "Not available"} tone={g.club} />
        <Tile label="Nation" value={g.player.nationality ?? "Not available"} tone={g.nationality} />
        <Tile label="Position" value={g.player.position ?? "Not available"} tone={g.position} />
        <Tile label="Age" value={g.age === null ? "Not available" : `${g.age}${AGE_LABEL[g.ageHint]}`} tone={ageTone} />
      </div>
    </li>
  );
}

function Countdown() {
  const [left, setLeft] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
      const s = Math.max(0, Math.floor((next - now.getTime()) / 1000));
      const pad = (n: number) => String(n).padStart(2, "0");
      setLeft(`${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="font-mono tabular-nums">{left ?? "--:--:--"}</span>;
}

function GuessInput({
  options,
  disabled,
  onPick,
}: {
  options: Option[];
  disabled: boolean;
  onPick: (o: Option) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const q = fold(query.trim());
    if (q.length < 2) return [];
    // Best first: name starts with the query, then a word in it does, then anywhere.
    const rank = (name: string) => {
      const n = fold(name);
      if (n.startsWith(q)) return 0;
      if (n.split(/[\s-]+/).some((w) => w.startsWith(q))) return 1;
      return n.includes(q) ? 2 : -1;
    };
    return options
      .map((o) => ({ o, r: rank(o.name) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r || a.o.name.localeCompare(b.o.name))
      .slice(0, 8)
      .map((x) => x.o);
  }, [query, options]);

  const pick = (o: Option) => {
    setQuery("");
    setActive(0);
    onPick(o);
    inputRef.current?.focus();
  };

  return (
    <div className="relative">
      <label htmlFor="footle-guess" className="sr-only">
        Guess a player
      </label>
      <Input
        id="footle-guess"
        ref={inputRef}
        role="combobox"
        aria-expanded={matches.length > 0}
        aria-controls={listId}
        aria-activedescendant={matches[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder="Type a player's name"
        value={query}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (!matches.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % matches.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a - 1 + matches.length) % matches.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(matches[active]);
          } else if (e.key === "Escape") {
            setQuery("");
          }
        }}
        className="h-11 text-base"
      />
      {matches.length === 0 && fold(query.trim()).length >= 2 && (
        <p className="absolute z-10 mt-1 w-full rounded-md border bg-popover p-2 text-sm text-muted-foreground shadow-md">
          No current Premier League player matches &ldquo;{query.trim()}&rdquo;.
        </p>
      )}
      {matches.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {matches.map((o, i) => (
            <li
              key={o.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex cursor-pointer items-baseline justify-between gap-3 rounded-sm px-2 py-1.5 text-sm",
                i === active && "bg-accent text-accent-foreground",
              )}
            >
              <span className="font-medium">{o.name}</span>
              <span className="truncate text-xs text-muted-foreground">{o.club}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FootleGame({ initialState, options }: { initialState: FootleState; options: Option[] }) {
  const [state, setState] = useState(initialState);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [manualShare, setManualShare] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const guessed = useMemo(() => new Set(state.guesses.map((g) => g.player.id)), [state.guesses]);
  const available = useMemo(() => options.filter((o) => !guessed.has(o.id)), [options, guessed]);
  const finished = state.status !== "playing";

  const guess = (o: Option) => {
    setError(null);
    startTransition(async () => {
      const result = await submitGuess(o.id);
      if (result.state) setState(result.state);
      if (!result.ok) setError(result.error);
    });
  };

  const share = async () => {
    const text = shareText(state.day, state.guesses, state.status === "won");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Some browsers block the clipboard; show the text to copy by hand.
      setManualShare(text);
    }
  };

  return (
    <section className="flex flex-col gap-5" aria-label={`Footle #${state.number}`}>
      <div className="flex items-baseline justify-between text-sm text-muted-foreground">
        <span>Footle #{state.number}</span>
        <span className="tabular-nums">
          {finished ? "Finished" : `Guess ${state.guesses.length + 1} of ${state.maxGuesses}`}
        </span>
      </div>

      {!finished && <GuessInput options={available} disabled={pending} onPick={guess} />}
      {pending && <p className="text-sm text-muted-foreground">Checking…</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {finished && state.answer && (
        <Card>
          <CardHeader>
            <CardTitle>
              {state.status === "won"
                ? `Got it in ${state.guesses.length}!`
                : "Out of guesses"}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p>
              Today&apos;s player was <span className="font-semibold">{state.answer.name}</span>
              {state.answer.club && <> ({state.answer.club})</>}: {state.answer.nationality}, {state.answer.position},
              age {ageOn(state.answer.birthDate, state.day)}.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={share}>{copied ? "Copied" : "Share result"}</Button>
              <span className="text-sm text-muted-foreground">
                Next Footle in <Countdown />
              </span>
            </div>
            {manualShare && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="footle-share" className="text-sm text-muted-foreground">
                  Your browser blocked copying. Select this text and copy it:
                </label>
                <textarea
                  id="footle-share"
                  readOnly
                  value={manualShare}
                  rows={manualShare.split("\n").length}
                  onFocus={(e) => e.currentTarget.select()}
                  className="resize-none rounded-md border bg-muted p-2 font-mono text-sm"
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {state.guesses.length > 0 ? (
        <ol className="flex flex-col gap-4">
          {[...state.guesses].reverse().map((g) => (
            <GuessRow key={g.player.id} g={g} />
          ))}
        </ol>
      ) : (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          Start typing a name. Green means a match. ↑ means the mystery player is older than your guess, ↓ younger.
        </p>
      )}
    </section>
  );
}
