"use client";

import { usePathname } from "next/navigation";
import { actAs } from "../actions";

type Person = { id: string; name: string; title: string; department: string };

export function ActorSwitcher({ people, current }: { people: Person[]; current: string }) {
  const pathname = usePathname();
  return (
    <form action={actAs} className="switcher">
      <label htmlFor="acting-as">Acting as</label>
      <input type="hidden" name="back" value={pathname} />
      <select
        id="acting-as"
        name="employeeId"
        defaultValue={current}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}, {p.title}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit">Switch</button>
      </noscript>
    </form>
  );
}
