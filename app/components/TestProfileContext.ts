import { createContext } from "react";

export interface TestProfileDetails {
  codeUrl: string;
  label: string;
  reviewUrl: string;
  webUrl: string;
}

export interface ProfilerReport {
  phase: "mount" | "update";
  actualDuration: number;
  baseDuration: number;
  startTime: number;
  commitTime: number;
  interactions: { id: number; name: string }[];
}

interface TestProfile {
  browserName: string;
  profile: Record<string, ProfilerReport[]>;
  timestamp: number;
}
export type TestProfiles = TestProfile[];

export interface TestProfileData {
  testProfileDetails: TestProfileDetails;
  testProfiles: TestProfiles;
}

export const Context = createContext<TestProfileData>(null!);
