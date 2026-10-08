"use client";
import { useI18n } from "@/lib/i18n/I18nProvider";

import { useLayoutEffect, useMemo, useRef, useState } from "react";

type QuickReplyTemplate = {
  id: string;
  title: string;
  situation: string;
  category: string;
  language: "English" | "French";
  channel: "WhatsApp" | "Email";
  message: string;
};

const clean = (text: string) => text.trim();

const templates: QuickReplyTemplate[] = [
  {
    id: "first-reply-whatsapp",
    title: "First client reply",
    situation: "Premier retour client",
    category: "Qualification",
    language: "English",
    channel: "WhatsApp",
    message: clean(`
Hello,

Thank you for your message.

One Address Riviera arranges private Riviera services including villas, luxury cars, private boats, chauffeurs, chefs, security and tailored concierge support.

Could you please share the service you are looking for, the dates, location, number of guests or passengers, and your estimated budget?

Once we have these details, we can review suitable private options.

Kind regards,
One Address Riviera
`)
  },
  {
    id: "quote-sent-whatsapp",
    title: "Quote sent",
    situation: "Devis envoyé",
    category: "Devis",
    language: "English",
    channel: "WhatsApp",
    message: clean(`
Hello,

I have just sent you the private proposal for your request.

Please review the details and let me know if you would like to proceed, adjust anything, or check an alternative option.

Availability is not held until confirmation.

Kind regards,
One Address Riviera
`)
  },
  {
    id: "quote-sent-email",
    title: "Quote sent - email",
    situation: "Devis envoyé",
    category: "Devis",
    language: "English",
    channel: "Email",
    message: clean(`
Hello,

Please find attached the private proposal prepared for your request.

The proposal includes the selected service, dates, pricing and key terms. Availability remains subject to confirmation until the booking is secured.

Please let me know if you would like to proceed or if any adjustment is required.

Kind regards,
One Address Riviera
`)
  },
  {
    id: "follow-up-24h",
    title: "Follow-up 24h",
    situation: "Relance 24h",
    category: "Relance",
    language: "English",
    channel: "WhatsApp",
    message: clean(`
Hello,

I’m following up regarding the private proposal sent yesterday.

Would you like us to hold this option and move forward, or would you prefer that we review an alternative?

Kind regards,
One Address Riviera
`)
  },
  {
    id: "follow-up-72h",
    title: "Follow-up 72h",
    situation: "Relance 72h",
    category: "Relance",
    language: "English",
    channel: "WhatsApp",
    message: clean(`
Hello,

Just following up once more regarding your private request.

As availability can move quickly, we will not hold the option without confirmation. If your request is still active, please let me know and we can review the next step.

Kind regards,
One Address Riviera
`)
  },
  {
    id: "negotiation",
    title: "Negotiation",
    situation: "Négociation",
    category: "Devis",
    language: "English",
    channel: "WhatsApp",
    message: clean(`
Hello,

Thank you for your feedback.

I will review what can reasonably be adjusted while keeping the service level aligned with the standard requested.

I will come back to you shortly with the best possible option.

Kind regards,
One Address Riviera
`)
  },
  {
    id: "accepted",
    title: "Quote accepted",
    situation: "Devis accepté",
    category: "Réservation",
    language: "English",
    channel: "WhatsApp",
    message: clean(`
Hello,

Thank you for your confirmation.

We will now proceed with the booking preparation. To secure everything properly, please confirm the final details and payment timing.

Once confirmed, we will coordinate the service and share the necessary information before the date.

Kind regards,
One Address Riviera
`)
  },
  {
    id: "lost-clean",
    title: "Lost cleanly",
    situation: "Devis perdu proprement",
    category: "Perdu",
    language: "English",
    channel: "WhatsApp",
    message: clean(`
Hello,

Thank you for letting us know.

No problem at all. We will close this request for now.

If you need private Riviera arrangements in the future, we would be happy to review a new request.

Kind regards,
One Address Riviera
`)
  },
  {
    id: "supplier-confirm",
    title: "Supplier to confirm",
    situation: "Prestataire à confirmer",
    category: "Opérations",
    language: "English",
    channel: "WhatsApp",
    message: clean(`
Hello,

We are currently confirming the selected provider for your request.

Once the operational details are secured, we will send you the final confirmation with timing, contact details and any practical instructions.

Kind regards,
One Address Riviera
`)
  },
  {
    id: "booking-confirmed",
    title: "Booking confirmed",
    situation: "Réservation confirmée",
    category: "Réservation",
    language: "English",
    channel: "WhatsApp",
    message: clean(`
Hello,

Your booking is now confirmed.

We will keep the arrangements discreet and coordinated. The practical details will be shared before the service date, including timing, address and contact information if needed.

Kind regards,
One Address Riviera
`)
  },
  {
    id: "payment-remaining",
    title: "Payment remaining",
    situation: "Paiement restant",
    category: "Paiement",
    language: "English",
    channel: "WhatsApp",
    message: clean(`
Hello,

A balance remains pending for your confirmed booking.

Could you please arrange the remaining payment before the agreed deadline so we can keep the service fully secured?

Kind regards,
One Address Riviera
`)
  },
  {
    id: "villa-qualification",
    title: "Villa qualification",
    situation: "Premier retour client",
    category: "Villa",
    language: "English",
    channel: "WhatsApp",
    message: clean(`
Hello,

To review suitable private villa options, could you please confirm the location, dates, number of guests, number of bedrooms required, preferred style and estimated weekly budget?

Once confirmed, we can check relevant private options and come back with a curated selection.

Kind regards,
One Address Riviera
`)
  },
  {
    id: "car-qualification",
    title: "Luxury car qualification",
    situation: "Premier retour client",
    category: "Voiture",
    language: "English",
    channel: "WhatsApp",
    message: clean(`
Hello,

To check suitable luxury car options, could you please confirm the dates, pick-up and drop-off location, preferred vehicle type, whether you need self-drive or chauffeur service, number of passengers and estimated budget?

Kind regards,
One Address Riviera
`)
  },
  {
    id: "boat-qualification",
    title: "Boat qualification",
    situation: "Premier retour client",
    category: "Bateau",
    language: "English",
    channel: "WhatsApp",
    message: clean(`
Hello,

To review private boat options, could you please confirm the preferred date, departure area, number of guests, full day or half day, preferred boat style or size, estimated budget and any preferred itinerary?

Kind regards,
One Address Riviera
`)
  },
  {
    id: "chauffeur-qualification",
    title: "Chauffeur qualification",
    situation: "Premier retour client",
    category: "Chauffeur",
    language: "English",
    channel: "WhatsApp",
    message: clean(`
Hello,

Could you please confirm the date and time, pick-up location, drop-off location, flight number if relevant, number of passengers, luggage quantity, preferred vehicle type, and whether you need a simple transfer or a private chauffeur during your stay?

Kind regards,
One Address Riviera
`)
  },
  {
    id: "not-aligned",
    title: "Not aligned / low budget",
    situation: "Demande non adaptée",
    category: "Qualification",
    language: "English",
    channel: "WhatsApp",
    message: clean(`
Hello,

Thank you for your message.

Based on the level of service requested, this may not be aligned with the private options we usually arrange at One Address Riviera.

We focus on tailored, high-standard private services with vetted partners across the French Riviera.

If your requirements or budget evolve, we would be happy to review a new request.

Kind regards,
One Address Riviera
`)
  }
];

const situations = ["Toutes", ...Array.from(new Set(templates.map((template) => template.situation)))];
const categories = ["Toutes", ...Array.from(new Set(templates.map((template) => template.category)))];
const channels = ["Tous", "WhatsApp", "Email"] as const;

export default function QuickRepliesView() {
  const {t, label: uiLabel} = useI18n();
  const liveT = useRef(t);
  useLayoutEffect(() => { liveT.current = t; }, [t]);

  const [situation, setSituation] = useState("Toutes");
  const [category, setCategory] = useState("Toutes");
  const [channel, setChannel] = useState<(typeof channels)[number]>("Tous");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(templates[0]?.id ?? "");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredTemplates = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return templates.filter((template) => {
      const matchesSituation = situation === "Toutes" || template.situation === situation;
      const matchesCategory = category === "Toutes" || template.category === category;
      const matchesChannel = channel === "Tous" || template.channel === channel;
      const matchesQuery = !needle || [
        template.title,
        template.situation,
        template.category,
        template.channel,
        template.message
      ].some((value) => value.toLowerCase().includes(needle));

      return matchesSituation && matchesCategory && matchesChannel && matchesQuery;
    });
  }, [situation, category, channel, query]);

  const selectedTemplate = useMemo(() => {
    return filteredTemplates.find((template) => template.id === selectedId) ?? filteredTemplates[0] ?? null;
  }, [filteredTemplates, selectedId]);

  async function copyMessage(template: QuickReplyTemplate) {
    try {
      await navigator.clipboard.writeText(template.message);
      setCopiedId(template.id);
      window.setTimeout(() => setCopiedId(null), 1600);
    } catch {
      window.alert(liveT.current("modules.quickRepliesView.unableToCopySelectTheTextManually"));
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{t("modules.quickRepliesView.quickReplies")}</p>
            <h3>{t("modules.quickRepliesView.messageLibrary")}</h3>
          </div>
          <p className="muted-line">

            {t("modules.quickRepliesView.selectASituationOnTheLeftThenCopyTheFullMessageOn")}
          </p>
        </div>

        <div className="form-grid">
          <label>{t("modules.quickRepliesView.situation")}
            <select value={situation} onChange={(event) => setSituation(event.target.value)}>
              {situations.map((item) => (
                <option key={item} value={item}>{uiLabel(item, "modules")}</option>
              ))}
            </select>
          </label>

          <label>{t("modules.quickRepliesView.category")}
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              {categories.map((item) => (
                <option key={item} value={item}>{uiLabel(item, "modules")}</option>
              ))}
            </select>
          </label>

          <label>{t("modules.quickRepliesView.channel")}
            <select value={channel} onChange={(event) => setChannel(event.target.value as typeof channel)}>
              {channels.map((item) => (
                <option key={item} value={item}>{uiLabel(item, "modules")}</option>
              ))}
            </select>
          </label>

          <label>{t("modules.moduleWorkspace.search")}
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("modules.quickRepliesView.egPaymentQuoteChauffeur")}
            />
          </label>
        </div>
      </section>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(280px, 0.8fr) minmax(620px, 1.6fr)",
          gap: 24,
          alignItems: "start"
        }}
      >
        <section className="card" style={{ padding: 22 }}>
          <div className="section-heading">
            <div>
              <p className="eyebrow">{t("modules.quickRepliesView.library")}</p>
              <h3>{t("modules.quickReplies.count", {count: filteredTemplates.length})}</h3>
            </div>
          </div>

          {filteredTemplates.length === 0 ? (
            <p className="muted-line">{t("modules.quickRepliesView.noRepliesMatchTheFilters")}</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {filteredTemplates.map((template) => {
                const isSelected = selectedTemplate?.id === template.id;

                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => setSelectedId(template.id)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      cursor: "pointer",
                      border: isSelected ? "1px solid rgba(201, 161, 86, 0.9)" : "1px solid rgba(7, 31, 39, 0.12)",
                      background: isSelected ? "rgba(201, 161, 86, 0.08)" : "rgba(255, 255, 255, 0.42)",
                      padding: "14px 16px",
                      boxShadow: "none"
                    }}
                  >
                    <p className="eyebrow" style={{ marginBottom: 6 }}>
                      {uiLabel(template.situation, "modules")} · {template.channel}
                    </p>
                    <strong style={{ display: "block", color: "#071f27", fontSize: 16 }}>
                      {t("modules.quickReplies.templateTitle." + template.id)}
                    </strong>
                    <span className="muted-line">{uiLabel(template.category, "modules")}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section
          className="card"
          style={{
            position: "sticky",
            top: 20,
            padding: 30,
            border: "1px solid rgba(201, 161, 86, 0.28)"
          }}
        >
          {selectedTemplate ? (
            <>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">
                    {uiLabel(selectedTemplate.situation, "modules")} · {uiLabel(selectedTemplate.category, "modules")} · {selectedTemplate.channel}
                  </p>
                  <h3>{t("modules.quickReplies.templateTitle." + selectedTemplate.id)}</h3>
                </div>
                <span className="status-pill">{t("modules.quickReplies.language." + selectedTemplate.language)}</span>
              </div>

              <div
                style={{
                  whiteSpace: "pre-wrap",
                  background: "rgba(255, 255, 255, 0.52)",
                  border: "1px solid rgba(7, 31, 39, 0.12)",
                  padding: 24,
                  minHeight: 540,
                  color: "#071f27",
                  fontSize: 16,
                  lineHeight: 1.75
                }}
              >
                {selectedTemplate.message}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
                <button className="primary-button" type="button" onClick={() => copyMessage(selectedTemplate)}>
                  {copiedId === selectedTemplate.id ? t("modules.quickRepliesView.copied") : t("modules.quickRepliesView.copyMessage")}
                </button>
              </div>
            </>
          ) : (
            <p className="muted-line">{t("modules.quickRepliesView.selectAReply")}</p>
          )}
        </section>
      </div>
    </div>
  );
}
