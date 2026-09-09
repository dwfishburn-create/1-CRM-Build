"use server";

import { revalidatePath } from "next/cache";
import { completeLeaseEvent } from "@/lib/leaseEvents";

export async function completeLeaseEventAction(formData: FormData) {
  const id = String(formData.get("id") || "").trim();
  if (!id) throw new Error("id is required.");

  await completeLeaseEvent(id);

  revalidatePath("/dashboard");
}
