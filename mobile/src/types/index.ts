export type WalkthroughType =
  | "MOVE_IN"
  | "MOVE_OUT"
  | "MID_TENANCY"
  | "MARKETING";

export type CapturedPhoto = {
  /** Stable client-side id used to track the photo through capture and upload. */
  id: string;
  /** Local file URI of the resized JPEG ready to upload. */
  uri: string;
  width: number;
  height: number;
  capturedAt: number;
};

export type Walkthrough = {
  id: string;
  propertyId: string;
  propertyName: string;
  type: WalkthroughType;
  createdAt: string;
};
