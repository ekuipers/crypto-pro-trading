    // Terms of Service modal — opened from the footer link (Suite roadmap:
    // footer disclaimer + ToS link, 2026-07-22). Static content, no network call.
    function openTermsModal() { $("termsModalBackdrop").style.display = "flex"; }
    function closeTermsModal() { $("termsModalBackdrop").style.display = "none"; }

    // Privacy policy modal (GDPR Art. 13) — same footer, same static idiom.
    // Lives here rather than in its own file because it is the identical
    // two-line show/hide and shares the footer link row.
    function openPrivacyModal() { $("privacyModalBackdrop").style.display = "flex"; }
    function closePrivacyModal() { $("privacyModalBackdrop").style.display = "none"; }
