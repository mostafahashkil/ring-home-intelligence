import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui";

export default function EventNotFound() {
  return (
    <EmptyState icon={SearchX} title="Event not found" action={<Link className="btn-secondary" href="/activity">Back to Activity</Link>}>
      It may have been removed by your retention settings or a data deletion.
    </EmptyState>
  );
}
