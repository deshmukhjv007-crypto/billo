"""Takedown notice generation.

Everything here is *template + evidence assembly*. The tool never sends email,
never auto-files, and refuses to dress a thin observation in legal language:
findings where the image could not actually be retrieved are flagged
"verify in a browser first", because a false accusation made under
penalty-of-perjury wording is a real exposure for you, not just for them.

Layout: prose paragraphs are re-wrapped; evidence blocks are emitted verbatim so
the aligned `label : value` lines stay readable when pasted into an email client.
"""

from __future__ import annotations

import textwrap
import time
from pathlib import Path

from .scan import Finding

WIDTH = 88

# jurisdiction -> (primary notice kind, citation)
JURISDICTION_NOTICE = {
    "IN": ("it_act", "Information Technology Act, 2000 § 79(2)(b) read with the IT Rules, 2021 "
                     "Rule 3(2)(b) — intermediary takedown notice"),
    "US": ("dmca", "17 U.S.C. § 512(c)(3) — DMCA notice of claimed infringement"),
    "EU": ("gdpr", "Regulation (EU) 2016/679 Art. 17 — right to erasure"),
}


def _prose(text: str) -> str:
    """Re-flow indented source text into clean, width-bounded paragraphs."""
    out, para = [], []
    for line in text.strip("\n").splitlines():
        line = " ".join(line.split())
        if line:
            para.append(line)
        elif para:
            out.append(textwrap.fill(" ".join(para), WIDTH))
            para = []
    if para:
        out.append(textwrap.fill(" ".join(para), WIDTH))
    return "\n\n".join(out)


def _evidence_block(f: Finding, grace_days: float | None) -> str:
    rows = [
        ("URL I identified as infringing", f.url or "—"),
    ]
    if f.image_url:
        rows.append(("Unauthorised copy served at", f.image_url))
    if f.image_size and any(f.image_size):
        rows.append(("Dimensions served", f"{f.image_size[0]}x{f.image_size[1]} px"))
    if f.image_sha256:
        rows.append(("SHA-256 of the served file", f.image_sha256))
    observed = f"verdict '{f.verdict}'"
    if f.provenance:
        observed += f" (from a saved capture, HTTP {f.status or 'n/a'})"
    else:
        observed += f" (HTTP {f.status or 'n/a'}, {f.latency_ms} ms observed)"
    rows.append(("What my automated check observed", observed))
    if f.match_detail:
        rows.append(("Comparison to my original file", f.match_detail))
    if f.meta_markers:
        rows.append(("Metadata still present in their copy", ", ".join(f.meta_markers)))
    hints = getattr(f, "asset_hints", None) or {}
    if hints:
        rows.append(("Instagram CDN parameters on that image URL",
                     "\n      " + "\n      ".join(f"{k} = {v}" for k, v in hints.items())))
        src_px = hints.get("source_px")
        shown = max(f.image_size or [0]) if f.image_size else None
        if src_px and (shown is None or shown < int(src_px)):
            rows.append(("Why that matters",
                         f"Instagram labels the source asset {hints.get('source_asset', src_px)}, "
                         f"i.e. a {src_px}px original is reachable, while only "
                         f"{hints.get('display', 'a thumbnail')} is displayed. A copy of my face is "
                         f"being distributed at a resolution I never published for display, and the "
                         f"file your service hands out is not a screenshot of a thumbnail."))
    if hints.get("wrapped_source_url"):
        rows.append(("Their copy is a proxy, not a link",
                     f"Decoding the `{hints.get('wrapped_via', 'o')}` parameter of the image URL "
                     f"above yields {hints['wrapped_source_url']} — your service fetches and "
                     f"re-serves the file from its own host (sp1/imginn-style asset paths), which is "
                     f"reproduction, not a hyperlink. This addresses the defence in advance."))
    for i, q in enumerate((getattr(f, "site_quotes", None) or [])[:3]):
        rows.append((f"Your own site states ({i + 1})", f'"{q}"'))
    prov = getattr(f, "provenance", "")
    if prov:
        rows.append(("How this evidence was captured", prov))
    if f.evidence_snippet:
        rows.append(("Captured markup", "\n".join("      " + ln for ln in
                                                   textwrap.wrap(f.evidence_snippet, WIDTH - 8))))
    rows.append(("Observation timestamp", time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime(f.ts))))
    if grace_days is not None:
        rows.append(("Days exposed (from my history)", f"{grace_days:.1f}"))
    width = max(len(k) for k, _ in rows)
    out = []
    for k, v in rows:
        first, _, rest = str(v).partition("\n")
        out.append(f"{k:<{width}}  {first}")
        if rest:
            out.append(rest)
    return "\n".join(out)


def notice_text(f: Finding, cfg_contact: dict, handle: str, kind: str,
                 baseline_desc: str = "my original Instagram profile photograph",
                 grace_days: float | None = None) -> str:
    def field(key: str, placeholder: str) -> str:
        val = str(cfg_contact.get(key) or "").strip()
        return placeholder if (not val or val.startswith("<MISSING")) else val

    name = field("name", "<YOUR FULL LEGAL NAME>")
    email = field("email", "<REPLY-TO EMAIL — fill contact.email, then re-run takedown>")
    addr = field("address", "<MAILING ADDRESS>")
    phone = field("phone", "<PHONE>")
    citation = {
        "dmca": "17 U.S.C. § 512(c)(3)",
        "it_act": "Section 79(2)(b) of the Information Technology Act, 2000, read with Rule "
                  "3(2)(b) of the Information Technology (Intermediary Guidelines and Digital Media "
                  "Ethics Code) Rules, 2021",
        "gdpr": "Article 17 GDPR (right to erasure), with Article 21 (objection) and "
                "Article 19 (notification to recipients)",
    }[kind]

    if kind == "dmca":
        body = _prose(f"""
            I am the copyright owner of the work identified below, or am authorised to act on the
            owner's behalf, and I give you notice of infringing material on your service under
            {citation}, requesting its removal.

            1. IDENTIFICATION OF THE COPYRIGHTED WORK
            {baseline_desc[0].upper()}{baseline_desc[1:]}, created by me and published at
            https://www.instagram.com/{handle}/ . I own the copyright in it; no licence, express or
            implied, was granted to you or to any of your users.

            2. IDENTIFICATION OF THE INFRINGING MATERIAL
        """)
        tail = _prose(f"""
            3. CONTACT INFORMATION
            Name: {name} | Address: {addr} | Phone: {phone} | Email: {email}

            4. GOOD-FAITH STATEMENT
            I have a good-faith belief that use of the material described above is not authorised by
            the copyright owner, its agent, or the law.

            5. STATEMENT OF ACCURACY UNDER PENALTY OF PERJURY
            I state under penalty of perjury that the information in this notification is accurate,
            and that I am the copyright owner of, or am authorised to act on behalf of the owner of,
            the exclusive right that is allegedly infringed.

            Please remove or disable access to the material identified above expeditiously and confirm
            once done. If a user files a counter-notice, I consent to my contact details being
            forwarded so the matter can be resolved directly.
        """)
    elif kind == "it_act":
        body = _prose(f"""
            I am the author of, and the person depicted in, the photograph described below. Its
            reproduction on your platform is unauthorised, and I give you actual notice under
            {citation}. The Rules require removal of infringing content within 36 hours of receipt,
            and of content revealing my identity within 24 hours.

            A. THE MATERIAL AND WHERE IT IS
        """)
        tail = _prose(f"""
            B. WHY IT MUST GO
            - My photograph is reproduced with no licence from me, and my handle is displayed beside
              it, making the copy attributable to me personally.
            - Your service surfaces it to anonymous visitors for downloading. That facilitates
              unwanted contact with me and is not protected by your safe harbour once you have
              actual knowledge, which this notice gives you.
            - If any of it was uploaded by a user, forward this notice to them; I am willing to be
              identified for the purpose of resolving it.

            C. REQUEST
            1. Remove the URLs above, purge them from cache, and request de-indexing so cached
               copies do not survive the removal.
            2. Suppress my handle '{handle}' from your directory and search results going forward.
            3. Confirm removal in writing to {email} within 36 hours of receipt.

            Absent action I will escalate to the Grievance Appellate Officer and the Ministry of
            Electronics and Information Technology grievance portal, and will rely on this notice and
            its timestamps as evidence of actual knowledge.
        """)
    else:  # gdpr
        body = _prose(f"""
            I request erasure of personal data which you are processing without a lawful basis. My
            photograph combined with my username is personal data under Article 4(1). Republishing it
            to anonymous visitors is not supported by consent, contract, or a legitimate interest
            that overrides my rights and freedoms, and I additionally object under Article 21 to any
            processing for profiling or tracking purposes. Legal basis for this request:
            {citation}.

            THE DATA AND WHERE IT IS
        """)
        tail = _prose(f"""
            Please, within one month as required by Article 12(3):
            1. Delete my image and my profile page, purge caches, and notify any recipients you
               supplied it to under Article 19.
            2. Tell me under Article 15 what personal data you hold about me, its source, and your
               retention period.
            3. Confirm completion in writing to {email}.

            If you refuse or ignore this request I will complain to my supervisory authority under
            Article 77 and seek a judicial remedy under Article 79.

            Name: {name} | Address: {addr} | Email: {email} | Phone: {phone}
        """)

    headers = [
        f"To:       {f.site_name} — copyright / abuse / grievance officer",
        f"From:     {name} <{email}>",
        f"Date:     {time.strftime('%d %B %Y')}",
        f"Subject:  Takedown request — unauthorised reproduction of my profile photograph "
        f"(handle: {handle})",
        "",
        textwrap.fill(f"Legal basis: {citation}", WIDTH),
    ]
    warn = ""
    if f.verdict == "profile-mirrored":
        warn = ("\n⚠️  BEFORE SENDING: this scanner could not retrieve the image file itself, only\n"
                "    the page. Open the URL in a browser, confirm your picture is there, screenshot\n"
                "    it with the date visible, then delete this warning line and send.\n")
    return (
        "\n".join(headers) + "\n" + warn + "\n" + body + "\n\n" + _evidence_block(f, grace_days)
        + "\n\n" + tail + f"\n\nSigned,\n/s/ {name}\n{'=' * WIDTH}\nGenerated by pp-watchdog, a "
        f"local evidence-assembly tool. Review this text yourself before sending: it is a\nstarting "
        "point written from machine observations, not legal advice, and only you can confirm the\n"
        "facts asserted in it are true of your work.\n"
    )


def instagram_report(handle: str, f: Finding) -> str:
    return _prose(f"""
        Instagram's own channels are the only route that can reduce what the platform serves to
        logged-out visitors, which is what the mirrors are feeding on in the first place.

          Report intellectual property (your photograph):
              https://help.instagram.com/contact/278619070935757
          Report a counterfeit or impersonating account:
              https://help.instagram.com/contact/636276399721841
          Privacy concern about your own data:
              https://help.instagram.com/contact/634636280114108
          Revoke any third-party app that already has account access:
              https://www.instagram.com/accounts/manage_access/

        Suggested wording:

          "A third-party service, {f.site_name} ({f.url}), reproduces my Instagram profile
          photograph and my handle without my licence, and offers it for anonymous viewing and
          download. I am the author and the subject of the photograph. I request that Instagram
          (a) treat this as unauthorised reproduction of my image under its Terms, and (b) confirm
          whether high-resolution variants of my profile picture are being served to unauthenticated
          requests for my handle while this is under review."

        Attach the file you originally uploaded, its SHA-256 ({f.image_sha256 or 'n/a'}), and a dated
        screenshot of {f.site_name}'s page showing your image.

        Expectation-setting, because it matters: Instagram can act against the service and can
        restrict what logged-out visitors see. It will not tell you who viewed your profile, and no
        appeal, form, or purchased tool changes that. Any promise otherwise is a credential-phishing
        attempt.
    """)


def build_pack(result, cfg) -> list[tuple[Path, str]]:
    """Write one notice set per actionable finding, plus an index and filing order."""
    contact = cfg.redacted_contact()
    out_dir: Path = cfg.notices_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    jurisdiction = (contact.get("jurisdiction") or "IN").upper()
    primary, citation = JURISDICTION_NOTICE.get(jurisdiction, JURISDICTION_NOTICE["IN"])
    ages = _exposure_ages(cfg, result)
    written: list[tuple[Path, str]] = []

    index = [f"# Takedown pack — `@{result.handle}`", "",
             f"Generated {time.strftime('%Y-%m-%d %H:%M')} · "
             f"{len(result.actionable)} site(s) with actionable evidence.",
             f"Primary route for your configured jurisdiction ({jurisdiction}): **{citation}**.", ""]
    if not result.actionable:
        index.append("_Nothing actionable this scan: no mirror produced evidence of serving your "
                     "picture. If several sites came back `unreachable` or `blocked-robots`, that is "
                     "an absence of measurement, not an absence of exposure — use `pp-watchdog links` "
                     "and check by browser._")
        path = out_dir / "README.md"
        path.write_text("\n".join(index) + "\n", encoding="utf-8")
        return [(path, "index")]

    for f in result.actionable:
        kinds = list(dict.fromkeys([primary, "dmca"] if jurisdiction != "US" else ["dmca", "it_act"]))
        if jurisdiction == "EU":
            kinds = ["gdpr", "dmca"]
        for kind in kinds:
            text = notice_text(f, contact, result.handle, kind, grace_days=ages.get(f.site_id))
            path = out_dir / f"{f.site_id}--{kind}.txt"
            path.write_text(text, encoding="utf-8")
            written.append((path, kind))
        warn = "  ⚠️ image not independently retrieved — verify in a browser before sending" \
            if f.verdict == "profile-mirrored" else ""
        index.append(
            f"## {f.site_name}\n"
            f"- verdict: `{f.verdict}` · page `{f.url}`\n"
            + (f"- copy: `{f.image_url}`\n" if f.image_url else "")
            + (f"- served resolution: {f.image_size[0]}x{f.image_size[1]} px · {f.match_detail}\n"
               if f.image_size and any(f.image_size) else "")
            + (f"- the mirrored file still carries: {', '.join(f.meta_markers)}\n"
               if f.meta_markers else "")
            + f"- abuse addresses harvested this run: "
            + (", ".join(f"`{c}`" for c in f.abuse_contacts) if f.abuse_contacts
               else "**none** — find theirs via their footer, /contact, and the registrar (see below)")
            + (f"\n{warn}" if warn else "")
            + "\n- files: " + ", ".join(f"`{f.site_id}--{k}.txt`" for k in kinds) + "\n"
        )
    index += ["", "## Instagram-side reports", "", instagram_report(result.handle, result.actionable[0]),
              "", "---", "", "## Filing order that actually works", ""]
    index.append(textwrap.dedent("""
        1. **Screenshot before you write.** Capture each page with URL bar and date visible. Some
           mirrors swap their cache the moment a complaint is in the air, and a notice you cannot
           evidence is a notice they will ignore.
        2. **Send to the abuse address, and CC the registrar.** Look the domain up at
           https://lookup.icann.org/ and copy the registrar's abuse contact. For unbranded viewer
           sites, registrar pressure moves faster than their inbox.
        3. **One site per email, one URL per notice.** `§512(c)(3)` and IT Rule 3(2)(b) both require
           specific identification; a bulk "delete everything of mine" letter is rejected as vague.
        4. **Log the send:** `pp-watchdog notice-sent <site_id> <kind>`. The +14 day follow-up is
           what actually gets these actioned — first notices from individuals are routinely shelved.
        5. **Then change your profile picture.** Their copy becomes the stale one, every downstream
           reuse starts pointing at a photo of you that no longer exists, and it is the fastest lever
           you have while the paperwork works.
        6. **Keep receipts.** `.pp-watchdog/` is the whole record; do not delete it until a matter is
           closed, and back it up somewhere that is not the same cloud as your Instagram login.
    """).strip())
    path = out_dir / "README.md"
    path.write_text("\n".join(index) + "\n", encoding="utf-8")
    written.insert(0, (path, "index"))
    return written


def _exposure_ages(cfg, result) -> dict[str, float]:
    ages: dict[str, float] = {}
    try:
        from .history import History

        h = History(cfg.db_path)
        for f in result.actionable:
            first = h.first_seen(f.site_id, ("serving-stale", "serving-current", "serving-hires"))
            if first:
                ages[f.site_id] = (time.time() - first) / 86400
        h.close()
    except Exception:
        pass
    return ages


def dispatch_log(cfg) -> list[dict]:
    from .history import History

    h = History(cfg.db_path)
    rows = h.notices()
    h.close()
    out = []
    for r in rows:
        sent, due = r.get("sent_on"), r.get("followup_due")
        out.append({
            "site": r["site_id"], "kind": r["kind"],
            "sent": time.strftime("%Y-%m-%d", time.gmtime(sent)) if sent else "queued",
            "status": r["response"],
            "followup_due": time.strftime("%Y-%m-%d", time.gmtime(due)) if due else "-",
            "due_epoch": due,
        })
    return out
