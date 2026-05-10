import { apiFetch } from "./client";
import type { Walkthrough, WalkthroughType } from "@/types";

export type CreateWalkthroughInput = {
  propertyId: string;
  type: WalkthroughType;
};

export function createWalkthrough(input: CreateWalkthroughInput) {
  return apiFetch<Walkthrough>("/api/walkthroughs", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function completeWalkthrough(walkthroughId: string) {
  return apiFetch<Walkthrough>(
    `/api/walkthroughs/${encodeURIComponent(walkthroughId)}/complete`,
    { method: "POST" },
  );
}
