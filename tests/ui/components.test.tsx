// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { EventCard } from "@/components/EventCard";
import { SeverityBadge, ChannelBadge } from "@/components/badges";
import { isUncertain } from "@/lib/household/association";
import { event } from "../helpers";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const review = { channel: "review" as const, ruleId: null, matchedRuleIds: [], explanation: [], suppressedBy: null, saveClip: false, requiresConfirmation: false, emergencyGuidance: false };

describe("EventCard", () => {
  it("visibly labels demo events and uncertain matches", () => {
    const e = event({
      demo: true,
      eventType: "arrival",
      summary: "Jack may have arrived — match uncertain",
      householdProfileId: "p",
      association: { profileId: "p", method: "demo_simulated", confidence: 0.58, status: "uncertain" },
      decision: review,
    });
    render(<ul><EventCard event={e} cameraName="Driveway" timeZone="UTC" /></ul>);
    const card = screen.getByRole("link");
    expect(card).toHaveAttribute("href", `/activity/${e.id}`);
    expect(within(card).getByText("Demo")).toBeInTheDocument();
    expect(within(card).getByText("Uncertain match")).toBeInTheDocument();
    expect(within(card).getByText("Needs review")).toBeInTheDocument();
  });

  it("shows confirmed labels instead of uncertainty once a person confirms", () => {
    const e = event({
      eventType: "arrival",
      summary: "Jack arrived home",
      householdProfileId: "p",
      association: { profileId: "p", method: "user_confirmed", confidence: null, status: "confirmed" },
      decision: review,
    });
    render(<ul><EventCard event={e} cameraName="Driveway" timeZone="UTC" /></ul>);
    expect(screen.getByText("Confirmed by you")).toBeInTheDocument();
    expect(screen.queryByText("Uncertain match")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs review")).not.toBeInTheDocument();
    expect(screen.queryByText("Demo")).not.toBeInTheDocument();
  });

  it("marks inferences and never shows a confidence badge without a score", () => {
    const e = event({ eventType: "package", summary: "Possible delivery", inference: { label: "Package activity", basis: "x" } });
    render(<ul><EventCard event={e} cameraName="Front door" timeZone="UTC" /></ul>);
    expect(screen.getByText("Inference")).toBeInTheDocument();
    expect(screen.queryByText(/confidence/)).not.toBeInTheDocument();
  });
});

describe("badges", () => {
  it("communicates severity and channel with text, not color alone", () => {
    render(
      <>
        <SeverityBadge severity="high" />
        <ChannelBadge channel="quiet_log" />
      </>,
    );
    expect(screen.getByText("Higher concern")).toBeInTheDocument();
    expect(screen.getByText("Quiet log")).toBeInTheDocument();
  });
});

describe("isUncertain", () => {
  it("is resolved by confirmation or removal", () => {
    expect(isUncertain({ association: { profileId: "p", method: "demo_simulated", confidence: 0.5, status: "uncertain" }, decision: review })).toBe(true);
    expect(isUncertain({ association: { profileId: "p", method: "user_confirmed", confidence: null, status: "confirmed" }, decision: review })).toBe(false);
    expect(isUncertain({ association: null, decision: review })).toBe(false);
  });
});
