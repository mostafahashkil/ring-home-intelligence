# Gated future research track: identity and record lookups

**Status: not implemented, and not planned for the MVP.**

The following are deliberately excluded from this product:

- Face recognition or biometric matching, for household members or anyone else
- Identity matching of strangers, and face-based internet or reverse-image searches
- Automatic criminal-record or watch-list checks
- Any label that calls a person a criminal, suspicious or dangerous based on appearance, a face match, clothing, an unverified website or an
  AI inference

## Requirements before any work could begin

If a legitimate use case is ever proposed, all of these come first:

1. **Assessment first.** A written feasibility, legal, privacy and source-quality assessment covering the jurisdictions involved (for
   example biometric privacy laws such as BIPA, GDPR and CCPA/CPRA), Ring platform terms and the Computer Vision Guidelines.
2. **An authorized, reliable data source** with a documented lawful basis. Scraping and unverified sources are not acceptable.
3. **Robust identity verification,** not resemblance. A visual similarity score is never treated as identity.
4. **Transparency in results:** every result shows its source, date, uncertainty and limitations.
5. **Human review, correction and appeal** for any consequential result, with no automated actions.
6. **Consent and minimization:** explicit opt-in from the people affected wherever the law requires it, minimal retention, and deletion on
   request.

Until all of these are met, the product stays limited to provider-reported events, user-confirmed household labels and neutral,
behavior-based descriptions.
