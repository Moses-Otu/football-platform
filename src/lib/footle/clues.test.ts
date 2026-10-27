import { describe, expect, it } from "vitest";

import {
  ageOn,
  compareGuess,
  dayIndex,
  positionGroup,
  puzzleNumber,
  shareText,
  type FootlePlayer,
} from "./clues";

const player = (over: Partial<FootlePlayer>): FootlePlayer => ({
  id: "p",
  name: "Player",
  club: "Club A",
  clubLogo: null,
  nationality: "England",
  position: "Midfielder",
  birthDate: "2000-06-15",
  ...over,
});

describe("positionGroup", () => {
  it("groups broad and detailed labels", () => {
    expect(positionGroup("Goalkeeper")).toBe("Goalkeeper");
    expect(positionGroup("Defence")).toBe("Defender");
    expect(positionGroup("Centre-Back")).toBe("Defender");
    expect(positionGroup("Defensive Midfield")).toBe("Midfielder");
    expect(positionGroup("Offence")).toBe("Forward");
    expect(positionGroup("Left Winger")).toBe("Forward");
  });

  it("returns null for missing or unknown labels, never a guess", () => {
    expect(positionGroup(null)).toBeNull();
    expect(positionGroup("Sweeper-keeper hybrid")).toBeNull();
  });
});

describe("ageOn", () => {
  it("counts birthdays correctly", () => {
    expect(ageOn("2000-06-15", "2026-06-14")).toBe(25);
    expect(ageOn("2000-06-15", "2026-06-15")).toBe(26);
    expect(ageOn("2000-06-15", "2026-10-27")).toBe(26);
  });

  it("is null without a birth date", () => {
    expect(ageOn(null, "2026-10-27")).toBeNull();
  });
});

describe("compareGuess", () => {
  const day = "2026-10-27";
  const answer = player({ id: "a", birthDate: "1995-01-01" });

  it("marks the right player correct", () => {
    const fb = compareGuess(answer, answer, day);
    expect(fb.correct).toBe(true);
    expect(fb.ageHint).toBe("match");
  });

  it("compares club, nationality and position", () => {
    const fb = compareGuess(player({ id: "g", club: "Club B", nationality: "England", position: "Forward" }), answer, day);
    expect(fb.correct).toBe(false);
    expect(fb.club).toBe("miss");
    expect(fb.nationality).toBe("match");
    expect(fb.position).toBe("miss");
  });

  it("says the answer is older when the guess is younger", () => {
    const fb = compareGuess(player({ id: "g", birthDate: "2002-01-01" }), answer, day);
    expect(fb.ageHint).toBe("older");
  });

  it("says the answer is younger when the guess is older", () => {
    const fb = compareGuess(player({ id: "g", birthDate: "1990-01-01" }), answer, day);
    expect(fb.ageHint).toBe("younger");
  });

  it("reports unknown, not a miss, when a fact is missing", () => {
    const fb = compareGuess(player({ id: "g", nationality: null, birthDate: null }), answer, day);
    expect(fb.nationality).toBe("unknown");
    expect(fb.ageHint).toBe("unknown");
  });
});

describe("puzzleNumber and dayIndex", () => {
  it("numbers puzzles from launch day", () => {
    expect(puzzleNumber("2026-10-27")).toBe(1);
    expect(puzzleNumber("2026-11-03")).toBe(8);
  });

  it("picks the same index for the same day, inside the pool", () => {
    expect(dayIndex("2026-10-27", 98)).toBe(dayIndex("2026-10-27", 98));
    for (const d of ["2026-10-27", "2026-10-28", "2027-01-01"]) {
      const i = dayIndex(d, 98);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(98);
    }
  });
});

describe("shareText", () => {
  it("shows the score and one row per guess without naming players", () => {
    const day = "2026-10-27";
    const answer = player({ id: "a", name: "Secret Name" });
    const miss = compareGuess(player({ id: "g", name: "Wrong Guess", club: "Club B" }), answer, day);
    const hit = compareGuess(answer, answer, day);
    const text = shareText(day, [miss, hit], true);
    expect(text.split("\n")[0]).toBe("Footle #1 2/6");
    expect(text.split("\n")).toHaveLength(3);
    expect(text).not.toContain("Secret Name");
    expect(text).not.toContain("Wrong Guess");
  });
});
