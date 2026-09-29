"use server";

import { revalidatePath } from "next/cache";
import { completeLeaseEvent } from "@/lib/leaseEvents";
import { setDeadlineCompleted } from "@/lib/deadlines";

export async function completeLeaseEventAction(formData: FormData) {
  const id = String(formData.get("id") || "").trim();
  if (!id) throw new Error("id is required.");

  await completeLeaseEvent(id);

  revalidatePath("/dashboard");
}

export async function completeDeadlineAction(formData: FormData) {
  const id = String(formData.get("id") || "").trim();
  if (!id) throw new Error("id is required.");

  await setDeadlineCompleted(id, true);

  revalidatePath("/dashboard");
}
