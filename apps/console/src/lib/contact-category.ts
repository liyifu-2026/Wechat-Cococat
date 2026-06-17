import type { DriverContact } from "@/lib/driver-types"
import { contactDisplayName } from "@/lib/driver-types"

export type ContactListSection = "individual" | "official"

export function contactListSection(
  contact: DriverContact,
): ContactListSection {
  if (contact.contactType === "official") return "official"
  return "individual"
}

export function isOfficialContact(contact: DriverContact): boolean {
  return contact.contactType === "official"
}

export function isPersonalContact(contact: DriverContact): boolean {
  return !isOfficialContact(contact)
}

export function filterContactsForList(
  contacts: DriverContact[],
): DriverContact[] {
  return contacts.filter(
    (c) =>
      c.contactType === "individual" ||
      c.contactType === "official" ||
      c.contactType === "openim" ||
      c.contactType === "unknown",
  )
}

export function groupContactsBySection(contacts: DriverContact[]): {
  individual: DriverContact[]
  official: DriverContact[]
} {
  const filtered = filterContactsForList(contacts)
  const individual: DriverContact[] = []
  const official: DriverContact[] = []
  for (const c of filtered) {
    if (contactListSection(c) === "official") official.push(c)
    else individual.push(c)
  }
  const byName = (a: DriverContact, b: DriverContact) =>
    contactDisplayName(a).localeCompare(contactDisplayName(b), "zh")
  individual.sort(byName)
  official.sort(byName)
  return { individual, official }
}

/** Stable id slug for customer type entries (settings CRUD). */
export function slugifyCustomerTypeId(
  label: string,
  used: Set<string>,
): string {
  const raw = label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\w\u4e00-\u9fff-]/g, "")
  const base = raw || `type_${Date.now()}`
  let id = base
  let n = 1
  while (used.has(id)) {
    id = `${base}_${n++}`
  }
  used.add(id)
  return id
}
