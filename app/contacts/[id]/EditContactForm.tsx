import { ActionForm } from "@/app/_components/ActionForm";
import { updateContactAction } from "./actions";

type Editable = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  mobile_phone: string | null;
};

// "Edit" panel under the contact's email/phone box (10/19/2026). Closed by
// default. The key changes whenever a saved value changes, so after a
// successful save the panel re-renders closed with the new values.
export function EditContactForm({ contact }: { contact: Editable }) {
  const input = "border border-gray-300 rounded px-2 py-1 text-sm w-full";
  const key = [
    contact.first_name,
    contact.last_name,
    contact.title,
    contact.email,
    contact.phone,
    contact.mobile_phone,
  ].join("|");

  const field = (name: keyof Editable, label: string, value: string | null, type = "text") => (
    <label className="flex flex-col gap-1 text-xs text-gray-500">
      {label}
      <input name={name} type={type} defaultValue={value ?? ""} className={input} />
    </label>
  );

  return (
    <details key={key} className="-mt-4 mb-6">
      <summary className="cursor-pointer text-sm text-blue-700 select-none">Edit</summary>
      <ActionForm
        action={updateContactAction}
        className="mt-3 grid grid-cols-3 gap-3 items-end border border-gray-200 rounded-lg p-4"
      >
        <input type="hidden" name="id" value={contact.id} />
        {field("first_name", "First name", contact.first_name)}
        {field("last_name", "Last name", contact.last_name)}
        {field("title", "Title", contact.title)}
        {field("email", "Email", contact.email, "email")}
        {field("phone", "Phone", contact.phone, "tel")}
        {field("mobile_phone", "Mobile", contact.mobile_phone, "tel")}
        <p className="col-span-2 text-xs text-gray-500">
          A blank field clears it. Company and notes aren&apos;t edited here.
        </p>
        <button
          type="submit"
          className="bg-blue-600 text-white rounded px-3 py-1.5 text-sm justify-self-end"
        >
          Save changes
        </button>
      </ActionForm>
    </details>
  );
}
