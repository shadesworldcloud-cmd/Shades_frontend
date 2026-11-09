import { useEffect, useState } from "react";
import { fetchDeliveryEstimate, isIndianPincode } from "../services/deliveryEstimate";

/**
 * Live delivery estimate for a pincode.
 * status: "idle" (no valid Indian pincode) | "loading" | "ready".
 * A slow answer for an earlier pincode never overwrites the current one.
 */
export default function useDeliveryEstimate(pincode) {
  const cleaned = String(pincode ?? "").trim();
  const valid = isIndianPincode(cleaned);
  const [state, setState] = useState({ pincode: null, estimate: null });

  useEffect(() => {
    if (!valid) return undefined;
    let active = true;
    fetchDeliveryEstimate(cleaned).then((estimate) => {
      if (active) setState({ pincode: cleaned, estimate });
    });
    return () => { active = false; };
  }, [cleaned, valid]);

  if (!valid) return { status: "idle", estimate: null };
  if (state.pincode !== cleaned) return { status: "loading", estimate: null };
  return { status: "ready", estimate: state.estimate };
}
