import type { Metadata } from "next";
import { LegalPage } from "../components/LegalPage";

export const metadata: Metadata = {
  title: "Terms — EBARA",
  description: "The terms for using EBARA as a personal vocabulary library.",
};

export default function TermsPage() {
  return (
    <LegalPage
      kind="terms"
      operatorName={process.env.NEXT_PUBLIC_LEGAL_OPERATOR_NAME?.trim() || "EBARA"}
      contactEmail={process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL?.trim() || ""}
    />
  );
}
