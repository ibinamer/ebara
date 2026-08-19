import type { Metadata } from "next";
import { LegalPage } from "../components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy — EBARA",
  description: "How EBARA processes and protects account and vocabulary data.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      kind="privacy"
      operatorName={process.env.NEXT_PUBLIC_LEGAL_OPERATOR_NAME?.trim() || "EBARA"}
      contactEmail={process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL?.trim() || ""}
    />
  );
}
