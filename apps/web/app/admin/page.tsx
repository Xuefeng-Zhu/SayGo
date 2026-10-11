import { StaffShell } from "../components/shell";
import { Admin } from "../components/staff";
export default function Page() {
  return (
    <StaffShell title="Menu & staff">
      <Admin />
    </StaffShell>
  );
}
