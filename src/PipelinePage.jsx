import { useState, useEffect } from "react";
import { db } from "./firebase";
import uniqlearnLogo from "./assets/uniqlearn-icon.png";
import uniqpathLogo from "./assets/uniqpath-icon.png";
import {
  collection, addDoc, onSnapshot, deleteDoc, doc,
  serverTimestamp, query, orderBy, updateDoc,
} from "firebase/firestore";
import PipelineDashboards from "./PipelineDashboards";
import { fetchDealContacts, fetchDealNotes, updateDealStage, updateDealAmount } from "./hubspot";

// ─── CSV seed data ────────────────────────────────────────────────────────────
const CSV_SEED_DATA = [
  // ── Active Pipeline ──────────────────────────────────────────────────────────
  { name: "West Carroll",                        value: 14100, bucket: "active",      manualConfidence: 100, meetingBooked: false, notes: "",                expectedCloseMonth: "2026-03" },
  { name: "Alabaster City",                      value: 5000,  bucket: "active",      manualConfidence: 0,   meetingBooked: false, notes: "Added to Q2",     expectedCloseMonth: "2026-05" },
  { name: "North Bergen",                        value: 0,     bucket: "active",      manualConfidence: 100, meetingBooked: false, notes: "",                expectedCloseMonth: "2026-03" },
  { name: "Cajon Valley",                        value: 10000, bucket: "active",      manualConfidence: 60,  meetingBooked: false, notes: "",                expectedCloseMonth: "2026-03" },
  { name: "CHSD 128",                            value: 5000,  bucket: "active",      manualConfidence: 0,   meetingBooked: true,  notes: "Added to March",  expectedCloseMonth: "2026-03" },
  { name: "Lancaster CSD",                       value: 5000,  bucket: "active",      manualConfidence: 100, meetingBooked: false, notes: "",                expectedCloseMonth: "2026-03" },
  { name: "Desert Hot Springs",                  value: 1500,  bucket: "active",      manualConfidence: 100, meetingBooked: false, notes: "",                expectedCloseMonth: "2026-03" },
  { name: "Weehawken",                           value: 5000,  bucket: "active",      manualConfidence: 0,   meetingBooked: true,  notes: "Added to March",  expectedCloseMonth: "2026-03" },
  { name: "Clayton County",                      value: 10000, bucket: "active",      manualConfidence: 10,  meetingBooked: false, notes: "",                expectedCloseMonth: "2026-03" },
  { name: "Palo Alto USD",                       value: 15000, bucket: "active",      manualConfidence: 0,   meetingBooked: false, notes: "",                expectedCloseMonth: "2026-03" },
  { name: "Mason City Schools",                  value: 10000, bucket: "active",      manualConfidence: 40,  meetingBooked: false, notes: "",                expectedCloseMonth: "2026-03" },
  { name: "Marymount NYC",                       value: 10000, bucket: "active",      manualConfidence: 50,  meetingBooked: false, notes: "",                expectedCloseMonth: "2026-03" },
  { name: "Greece Central",                      value: 50000, bucket: "active",      manualConfidence: 75,  meetingBooked: false, notes: "",                expectedCloseMonth: "2026-03" },
  { name: "Frederick County",                    value: 20000, bucket: "active",      manualConfidence: 0,   meetingBooked: false, notes: "Added to Q2",     expectedCloseMonth: "2026-05" },
  { name: "Libertyville D70",                    value: 5000,  bucket: "active",      manualConfidence: 0,   meetingBooked: false, notes: "",                expectedCloseMonth: "2026-03" },
  { name: "Greenwood SD50",                      value: 4500,  bucket: "active",      manualConfidence: 0,   meetingBooked: false, notes: "",                expectedCloseMonth: "2026-03" },
  { name: "Harrison SD2",                        value: 10000, bucket: "active",      manualConfidence: 25,  meetingBooked: false, notes: "",                expectedCloseMonth: "2026-03" },
  { name: "Greenville CSD",                      value: 10000, bucket: "active",      manualConfidence: 35,  meetingBooked: false, notes: "",                expectedCloseMonth: "2026-03" },
  { name: "Randolph Central",                    value: 5000,  bucket: "active",      manualConfidence: 10,  meetingBooked: false, notes: "",                expectedCloseMonth: "2026-03" },
  { name: "Bibb County",                         value: 7500,  bucket: "active",      manualConfidence: 60,  meetingBooked: false, notes: "",                expectedCloseMonth: "2026-03" },
  { name: "Health, Arts, etc. NYC",              value: 5000,  bucket: "active",      manualConfidence: 10,  meetingBooked: false, notes: "",                expectedCloseMonth: "2026-03" },
  { name: "Lockhart ISD",                        value: 10000, bucket: "active",      manualConfidence: 85,  meetingBooked: true,  notes: "",                expectedCloseMonth: "2026-03" },
  { name: "Daleville Community Schools",         value: 5000,  bucket: "active",      manualConfidence: 35,  meetingBooked: false, notes: "",                expectedCloseMonth: "2026-03" },
  { name: "Dayton Public Schools",               value: 9000,  bucket: "active",      manualConfidence: 10,  meetingBooked: false, notes: "",                expectedCloseMonth: "2026-03" },
  { name: "New Hope",                            value: 7500,  bucket: "active",      manualConfidence: 0,   meetingBooked: false, notes: "",                expectedCloseMonth: "2026-04" },
  { name: "Texarkana Arkansas School District",  value: 7500,  bucket: "active",      manualConfidence: 0,   meetingBooked: false, notes: "",                expectedCloseMonth: "2026-04" },

  // ── Future Q1–Q2 (ERDI Jan / conference leads) ───────────────────────────────
  { name: "Tempe Elementary School District",                  value: 10000, bucket: "future_q1q2", manualConfidence: 30, meetingBooked: false, notes: "ERDI Jan",    expectedCloseMonth: "2026-04" },
  { name: "Agua Fria Union High School District",              value: 10000, bucket: "future_q1q2", manualConfidence: 30, meetingBooked: true,  notes: "Conference",  expectedCloseMonth: "2026-04" },
  { name: "Atlanta Public Schools (Charter)",                  value: 10000, bucket: "future_q1q2", manualConfidence: 50, meetingBooked: true,  notes: "Conference",  expectedCloseMonth: "2026-04" },
  { name: "Central Susquehanna IU (PA)",                       value: 10000, bucket: "future_q1q2", manualConfidence: 30, meetingBooked: false, notes: "",            expectedCloseMonth: "2026-04" },
  { name: "Little Rock School District",                       value: 10000, bucket: "future_q1q2", manualConfidence: 50, meetingBooked: true,  notes: "",            expectedCloseMonth: "2026-04" },
  { name: "Marana School District",                            value: 10000, bucket: "future_q1q2", manualConfidence: 50, meetingBooked: true,  notes: "",            expectedCloseMonth: "2026-04" },
  { name: "Puget Sound ESD",                                   value: 10000, bucket: "future_q1q2", manualConfidence: 30, meetingBooked: false, notes: "Conference",  expectedCloseMonth: "2026-04" },
  { name: "Farmington Public Schools",                         value: 10000, bucket: "future_q1q2", manualConfidence: 30, meetingBooked: false, notes: "Conference",  expectedCloseMonth: "2026-04" },
  { name: "Papillion La-Vista School District",                value: 10000, bucket: "future_q1q2", manualConfidence: 30, meetingBooked: false, notes: "",            expectedCloseMonth: "2026-04" },
  { name: "Jefferson County SD",                               value: 5000,  bucket: "future_q1q2", manualConfidence: 50, meetingBooked: false, notes: "",            expectedCloseMonth: "2026-04" },
  { name: "Slate Valley Unified Union School District",        value: 5000,  bucket: "future_q1q2", manualConfidence: 30, meetingBooked: false, notes: "Conference",  expectedCloseMonth: "2026-04" },
  { name: "Distinctive Schools",                               value: 10000, bucket: "future_q1q2", manualConfidence: 30, meetingBooked: false, notes: "Conference",  expectedCloseMonth: "2026-04" },
  { name: "West Palm Beach",                                   value: 10000, bucket: "future_q1q2", manualConfidence: 30, meetingBooked: false, notes: "FETC Jan",    expectedCloseMonth: "2026-04" },
  { name: "South Amboy School District",                       value: 10000, bucket: "future_q1q2", manualConfidence: 20, meetingBooked: true,  notes: "AASA",        expectedCloseMonth: "2026-04" },
  { name: "Middle Sex County Magnet Schools",                  value: 10000, bucket: "future_q1q2", manualConfidence: 20, meetingBooked: false, notes: "AASA",        expectedCloseMonth: "2026-04" },
  { name: "Carteret School District",                          value: 10000, bucket: "future_q1q2", manualConfidence: 20, meetingBooked: true,  notes: "AASA",        expectedCloseMonth: "2026-04" },
  { name: "Watson Chapel",                                     value: 10000, bucket: "future_q1q2", manualConfidence: 20, meetingBooked: true,  notes: "AASA",        expectedCloseMonth: "2026-04" },
  { name: "JFK Middle School",                                 value: 10000, bucket: "future_q1q2", manualConfidence: 20, meetingBooked: false, notes: "AASA",        expectedCloseMonth: "2026-04" },
  { name: "Central Magnet School",                             value: 10000, bucket: "future_q1q2", manualConfidence: 20, meetingBooked: false, notes: "AASA",        expectedCloseMonth: "2026-04" },
  { name: "Kentwood Public Schools",                           value: 10000, bucket: "future_q1q2", manualConfidence: 20, meetingBooked: false, notes: "Conference",  expectedCloseMonth: "2026-04" },
  { name: "Cherokee County Schools",                           value: 10000, bucket: "future_q1q2", manualConfidence: 20, meetingBooked: false, notes: "Conference",  expectedCloseMonth: "2026-04" },
  { name: "Seneca Valley",                                     value: 10000, bucket: "future_q1q2", manualConfidence: 20, meetingBooked: false, notes: "Conference",  expectedCloseMonth: "2026-04" },
  { name: "Fox Chapel Area SD",                                value: 10000, bucket: "future_q1q2", manualConfidence: 20, meetingBooked: false, notes: "Conference",  expectedCloseMonth: "2026-04" },
  { name: "IU 17 (PA)",                                        value: 10000, bucket: "future_q1q2", manualConfidence: 20, meetingBooked: false, notes: "Conference",  expectedCloseMonth: "2026-04" },
  { name: "Weehawken (Future)",                                value: 5000,  bucket: "future_q1q2", manualConfidence: 50, meetingBooked: false, notes: "March Events", expectedCloseMonth: "2026-04" },
  { name: "CHSD 128 (Future)",                                 value: 10000, bucket: "future_q1q2", manualConfidence: 35, meetingBooked: false, notes: "March Events", expectedCloseMonth: "2026-04" },

  // ── Future Q2 (Q2 Start cohort) ──────────────────────────────────────────────
  { name: "Greenwood SD",                        value: 12000, bucket: "future_q1q2", manualConfidence: 50, meetingBooked: false, notes: "Q2",             expectedCloseMonth: "2026-05" },
  { name: "Frederick County (Shante)",           value: 20000, bucket: "future_q1q2", manualConfidence: 25, meetingBooked: false, notes: "Q2",             expectedCloseMonth: "2026-05" },
  { name: "Alabaster City Schools",              value: 10000, bucket: "future_q1q2", manualConfidence: 35, meetingBooked: false, notes: "Q2",             expectedCloseMonth: "2026-05" },
  { name: "Texarkana (Future)",                  value: 7500,  bucket: "future_q1q2", manualConfidence: 35, meetingBooked: false, notes: "Q2",             expectedCloseMonth: "2026-05" },

  // ── Future Q3-Q4 ─────────────────────────────────────────────────────────────
  { name: "Q3 District 1",  value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "ERDI July", expectedCloseMonth: "2026-07" },
  { name: "Q3 District 2",  value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "ERDI July", expectedCloseMonth: "2026-07" },
  { name: "Q3 District 3",  value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "ERDI July", expectedCloseMonth: "2026-07" },
  { name: "Q3 District 4",  value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "ERDI July", expectedCloseMonth: "2026-07" },
  { name: "Q3 District 5",  value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "ERDI July", expectedCloseMonth: "2026-08" },
  { name: "Q3 District 6",  value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "",         expectedCloseMonth: "2026-08" },
  { name: "Q3 District 7",  value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "",         expectedCloseMonth: "2026-08" },
  { name: "Q3 District 8",  value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "",         expectedCloseMonth: "2026-08" },
  { name: "Q3 District 9",  value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "",         expectedCloseMonth: "2026-09" },
  { name: "Q3 District 10", value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "",         expectedCloseMonth: "2026-09" },
  { name: "Q3 District 11", value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "Old Soul", expectedCloseMonth: "2026-09" },
  { name: "Q3 District 12", value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "",         expectedCloseMonth: "2026-09" },
  { name: "Q3 District 13", value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "",         expectedCloseMonth: "2026-09" },
  { name: "Q3 District 14", value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "",         expectedCloseMonth: "2026-09" },
  { name: "Q3 District 15", value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "Old Soul", expectedCloseMonth: "2026-09" },
  { name: "Q3 District 16", value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "",         expectedCloseMonth: "2026-09" },
  { name: "Q3 District 17", value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "",         expectedCloseMonth: "2026-09" },
  { name: "Q3 District 18", value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "",         expectedCloseMonth: "2026-09" },
  { name: "Q3 District 19", value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "Old Soul", expectedCloseMonth: "2026-09" },
  { name: "Q3 District 20", value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "",         expectedCloseMonth: "2026-09" },
  { name: "Q3 District 21", value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "",         expectedCloseMonth: "2026-09" },
  { name: "Q3 District 22", value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "",         expectedCloseMonth: "2026-09" },
  { name: "Q4 Edtech Week District 23", value: 15000, bucket: "future_q3q4", manualConfidence: 20, meetingBooked: false, notes: "Edtech Week", expectedCloseMonth: "2026-10" },
  { name: "Q4 Edtech Week District 24", value: 15000, bucket: "future_q3q4", manualConfidence: 20, meetingBooked: false, notes: "Edtech Week", expectedCloseMonth: "2026-10" },
  { name: "Q4 Edtech Week District 25", value: 15000, bucket: "future_q3q4", manualConfidence: 20, meetingBooked: false, notes: "Edtech Week", expectedCloseMonth: "2026-10" },
  { name: "Q4 ERDI Oct District 26",    value: 15000, bucket: "future_q3q4", manualConfidence: 25, meetingBooked: false, notes: "ERDI Oct",   expectedCloseMonth: "2026-10" },
  { name: "Q4 ERDI Oct District 27",    value: 15000, bucket: "future_q3q4", manualConfidence: 25, meetingBooked: false, notes: "ERDI Oct",   expectedCloseMonth: "2026-10" },
  { name: "Q4 ERDI Oct District 28",    value: 15000, bucket: "future_q3q4", manualConfidence: 25, meetingBooked: false, notes: "ERDI Oct",   expectedCloseMonth: "2026-10" },
  { name: "Q4 ERDI Oct District 29",    value: 15000, bucket: "future_q3q4", manualConfidence: 25, meetingBooked: false, notes: "ERDI Oct",   expectedCloseMonth: "2026-10" },
  { name: "Q4 ERDI Oct District 30",    value: 15000, bucket: "future_q3q4", manualConfidence: 25, meetingBooked: false, notes: "ERDI Oct",   expectedCloseMonth: "2026-11" },
  { name: "Q4 ERDI Oct District 31",    value: 15000, bucket: "future_q3q4", manualConfidence: 25, meetingBooked: false, notes: "ERDI Oct",   expectedCloseMonth: "2026-11" },
  { name: "Q4 District 32",             value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "",           expectedCloseMonth: "2026-11" },
  { name: "Q4 District 33",             value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "",           expectedCloseMonth: "2026-11" },
  { name: "Q4 District 34",             value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "",           expectedCloseMonth: "2026-11" },
  { name: "Q4 District 35",             value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "",           expectedCloseMonth: "2026-11" },
  { name: "Q4 Events District 36",      value: 15000, bucket: "future_q3q4", manualConfidence: 25, meetingBooked: false, notes: "Q4 Events",  expectedCloseMonth: "2026-11" },
  { name: "Q4 Events District 37",      value: 15000, bucket: "future_q3q4", manualConfidence: 25, meetingBooked: false, notes: "Q4 Events",  expectedCloseMonth: "2026-11" },
  { name: "Q4 Events District 38",      value: 15000, bucket: "future_q3q4", manualConfidence: 25, meetingBooked: false, notes: "Q4 Events",  expectedCloseMonth: "2026-12" },
  { name: "Q4 Old Soul District 39",    value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "Old Soul",   expectedCloseMonth: "2026-12" },
  { name: "Q4 District 40",             value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "",           expectedCloseMonth: "2026-12" },
  { name: "Q4 District 41",             value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "",           expectedCloseMonth: "2026-12" },
  { name: "Q4 District 42",             value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "",           expectedCloseMonth: "2026-12" },
  { name: "Q4 Old Soul District 43",    value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "Old Soul",   expectedCloseMonth: "2026-12" },
  { name: "Q4 District 44",             value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "",           expectedCloseMonth: "2026-12" },
  { name: "Q4 District 45",             value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "",           expectedCloseMonth: "2026-12" },
  { name: "Q4 District 46",             value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "",           expectedCloseMonth: "2026-12" },
  { name: "Q4 Old Soul District 47",    value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "Old Soul",   expectedCloseMonth: "2026-12" },
  { name: "Q4 District 48",             value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "",           expectedCloseMonth: "2026-12" },
  { name: "Q4 District 49",             value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "",           expectedCloseMonth: "2026-12" },
  { name: "Q4 District 50",             value: 10000, bucket: "future_q3q4", manualConfidence: 30, meetingBooked: false, notes: "",           expectedCloseMonth: "2026-12" },

  // ── Renewals ─────────────────────────────────────────────────────────────────
  { name: "Shenandoah",          value: 6000,  bucket: "renewal", manualConfidence: 85, meetingBooked: false, notes: "Current: $4,340",  expectedCloseMonth: "2026-05" },
  { name: "Randolph Eastern",    value: 9500,  bucket: "renewal", manualConfidence: 50, meetingBooked: false, notes: "Current: $6,000",  expectedCloseMonth: "2026-05" },
  { name: "Peekskill",           value: 12000, bucket: "renewal", manualConfidence: 85, meetingBooked: false, notes: "Current: $9,720",  expectedCloseMonth: "2026-05" },
  { name: "MCESC",               value: 25000, bucket: "renewal", manualConfidence: 25, meetingBooked: false, notes: "Current: $25,000", expectedCloseMonth: "2026-05" },
  { name: "ResponsiveEd",        value: 40000, bucket: "renewal", manualConfidence: 50, meetingBooked: false, notes: "Current: $29,000", expectedCloseMonth: "2026-06" },
  { name: "Dougherty County",    value: 10000, bucket: "renewal", manualConfidence: 50, meetingBooked: false, notes: "Current: $27,000 — down-sell", expectedCloseMonth: "2026-06" },
  { name: "Edison Township",     value: 8000,  bucket: "renewal", manualConfidence: 35, meetingBooked: false, notes: "Current: $8,000",  expectedCloseMonth: "2026-06" },
  { name: "Rancho Mirage",       value: 5000,  bucket: "renewal", manualConfidence: 40, meetingBooked: true,  notes: "Current: $7,600 — down-sell", expectedCloseMonth: "2026-06" },
  { name: "New Hope-Solebury",   value: 15000, bucket: "renewal", manualConfidence: 35, meetingBooked: true,  notes: "Current: $10,000 — expansion", expectedCloseMonth: "2026-07" },
  { name: "Val Verde USD",       value: 20000, bucket: "renewal", manualConfidence: 50, meetingBooked: true,  notes: "Current: $5,000 — expansion",  expectedCloseMonth: "2026-07" },
  { name: "Lancaster County SD", value: 20000, bucket: "renewal", manualConfidence: 50, meetingBooked: false, notes: "Current: $5,000 — expansion",  expectedCloseMonth: "2026-08" },
];

// ─── constants ────────────────────────────────────────────────────────────────
const BUCKETS = [
  { id: "active",      label: "Active Pipeline"  },
  { id: "future_q1q2", label: "Future Q1–Q2"      },
  { id: "future_q3q4", label: "Future Q3–Q4"      },
  { id: "renewal",     label: "Renewals"          },
  { id: "untagged",    label: "Untagged"          },
];

const PRODUCTS = [
  { id: "uniqlearn", label: "UniqLearn", color: "#0ea5e9" },
  { id: "uniqpath",  label: "UniqPath",  color: "#a855f7" },
  { id: "both",      label: "Both",      color: "#f59e0b" },
];

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

// ─── helpers ─────────────────────────────────────────────────────────────────
function formatCurrency(n) {
  if (!n || isNaN(n)) return "$0";
  return "$" + Math.round(n).toLocaleString("en-US");
}

function computeAlgoConfidence(deal) {
  let score = deal.hubspotStageProbability != null
    ? deal.hubspotStageProbability * 100
    : 30;

  if (deal.meetingBooked) score += 15;

  const t = deal.touchCount || 0;
  if (t >= 6)      score += 20;
  else if (t >= 3) score += 10;
  else if (t >= 1) score += 5;

  if (deal.lastActivityDate) {
    const days = Math.floor(
      (Date.now() - new Date(deal.lastActivityDate)) / 86_400_000
    );
    if (days >= 60)      score -= 20;
    else if (days >= 30) score -= 10;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function getEffectiveConfidence(deal) {
  return deal.useAlgoConfidence
    ? computeAlgoConfidence(deal)
    : (deal.manualConfidence ?? 50);
}

function getMonthOptions() {
  const opts = [];
  const now = new Date();
  for (let i = -2; i < 18; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    opts.push({ value, label });
  }
  return opts;
}
const MONTH_OPTIONS = getMonthOptions();

function getProductMeta(productId) {
  return PRODUCTS.find(p => p.id === productId) || null;
}

function fmtTimestamp(ts) {
  if (!ts) return null;
  let d;
  if (typeof ts.toDate === "function") d = ts.toDate();
  else if (ts.seconds) d = new Date(ts.seconds * 1000);
  else d = new Date(ts);
  return isNaN(d) ? null : d;
}

function fmtCreatedAt(ts) {
  const d = fmtTimestamp(ts);
  return d ? d.toLocaleDateString("en-US", { month: "short", year: "numeric" }) : null;
}


// ─── DealRow ──────────────────────────────────────────────────────────────────
function DealRow({ deal, onUpdate, onDelete, events = [], token }) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(deal);
  const [hsContacts, setHsContacts] = useState([]);
  const [hsNotes,    setHsNotes]    = useState([]);
  const [hsLoading,  setHsLoading]  = useState(false);

  useEffect(() => { setLocal(deal); }, [deal]);

  useEffect(() => {
    if (!editing || !deal.hubspotId || !token) return;
    setHsLoading(true);
    Promise.all([
      fetchDealContacts(token, deal.hubspotId).catch(() => []),
      fetchDealNotes(token, deal.hubspotId).catch(() => []),
    ]).then(([c, n]) => {
      setHsContacts(c);
      setHsNotes(n);
      setHsLoading(false);
    });
  }, [editing, deal.hubspotId, token]);

  const effective = getEffectiveConfidence(local);
  const adjustedValue = (local.value || 0) * (effective / 100);
  const confidenceColor = effective >= 70 ? "#4ade80" : effective >= 40 ? "#fbbf24" : "#f87171";
  const productMeta = getProductMeta(local.product);

  function save() {
    onUpdate(deal.id, local);
    setEditing(false);
  }

  const cell = {
    padding: "8px 10px",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
    verticalAlign: "middle",
    color: "var(--text-body)",
    fontSize: 13,
  };
  const inp = {
    background: "var(--surface-deep)",
    border: "1px solid #334155",
    borderRadius: 4,
    color: "var(--text-body)",
    padding: "4px 8px",
    fontSize: 13,
  };

  if (editing) {
    return (
      <tr style={{ background: "#1a2744" }}>
        <td style={{ ...cell, borderBottom: "none" }} colSpan={7}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "6px 0" }}>

            {/* Row 0: contact info + product + state */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div>
                <label style={{ fontSize: 11, color: "var(--text-label)", display: "block", marginBottom: 3 }}>Contact Name</label>
                <input
                  value={local.contactName || ""}
                  onChange={e => setLocal(p => ({ ...p, contactName: e.target.value }))}
                  style={{ ...inp, width: 160 }}
                  placeholder="e.g. Jane Smith"
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "var(--text-label)", display: "block", marginBottom: 3 }}>Contact Info</label>
                <input
                  value={local.contactInfo || ""}
                  onChange={e => setLocal(p => ({ ...p, contactInfo: e.target.value }))}
                  style={{ ...inp, width: 200 }}
                  placeholder="email or phone"
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "var(--text-label)", display: "block", marginBottom: 3 }}>Product</label>
                <select
                  value={local.product || ""}
                  onChange={e => setLocal(p => ({ ...p, product: e.target.value }))}
                  style={inp}
                >
                  <option value="">— Select —</option>
                  {PRODUCTS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: "var(--text-label)", display: "block", marginBottom: 3 }}>State</label>
                <select
                  value={local.state || ""}
                  onChange={e => setLocal(p => ({ ...p, state: e.target.value }))}
                  style={{ ...inp, width: 80 }}
                >
                  <option value="">—</option>
                  {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            {/* Row 0.5: funnel source */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <label style={{ fontSize: 11, color: "var(--text-label)", display: "block", marginBottom: 4 }}>Funnel Source</label>
                <div style={{ display: "flex", gap: 6 }}>
                  {[["", "None"], ["outbound", "Outbound"], ["event", "Event"], ["podcast", "Podcast"]].map(([type, label]) => (
                    <button
                      key={type}
                      onClick={() => setLocal(p => ({ ...p, funnelType: type, funnelEventId: type !== "event" ? "" : p.funnelEventId }))}
                      style={{
                        padding: "4px 11px", borderRadius: 4, fontSize: 12, border: "none", cursor: "pointer",
                        background: local.funnelType === type
                          ? (type === "outbound" ? "#b45309" : type === "event" ? "#0369a1" : type === "podcast" ? "#6d28d9" : "#6366f1")
                          : "var(--border-strong)",
                        color: "#fff",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {local.funnelType === "event" && (
                <div>
                  <label style={{ fontSize: 11, color: "var(--text-label)", display: "block", marginBottom: 3 }}>Event</label>
                  <select
                    value={local.funnelEventId || ""}
                    onChange={e => setLocal(p => ({ ...p, funnelEventId: e.target.value }))}
                    style={{ ...inp, minWidth: 180 }}
                  >
                    <option value="">— Select event —</option>
                    {[...events].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(ev => (
                      <option key={ev.id} value={ev.id}>
                        {ev.name}{ev.date ? ` (${ev.date})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Row 1: name / value / close month / bucket */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div>
                <label style={{ fontSize: 11, color: "var(--text-label)", display: "block", marginBottom: 3 }}>Customer Name</label>
                <input
                  value={local.name}
                  onChange={e => setLocal(p => ({ ...p, name: e.target.value }))}
                  style={{ ...inp, width: 190 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "var(--text-label)", display: "block", marginBottom: 3 }}>Contract Size ($)</label>
                <input
                  type="number"
                  value={local.value}
                  onChange={e => setLocal(p => ({ ...p, value: parseFloat(e.target.value) || 0 }))}
                  style={{ ...inp, width: 110 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "var(--text-label)", display: "block", marginBottom: 3 }}>Close Month</label>
                <select
                  value={local.expectedCloseMonth || ""}
                  onChange={e => setLocal(p => ({ ...p, expectedCloseMonth: e.target.value }))}
                  style={{ ...inp }}
                >
                  <option value="">None</option>
                  {MONTH_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: "var(--text-label)", display: "block", marginBottom: 3 }}>Bucket</label>
                <select
                  value={local.bucket}
                  onChange={e => setLocal(p => ({ ...p, bucket: e.target.value }))}
                  style={{ ...inp }}
                >
                  {BUCKETS.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                </select>
              </div>
            </div>

            {/* Row 2: confidence / meeting / touches / last activity */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <label style={{ fontSize: 11, color: "var(--text-label)", display: "block", marginBottom: 4 }}>Confidence Mode</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => setLocal(p => ({ ...p, useAlgoConfidence: true }))}
                    style={{ padding: "4px 11px", borderRadius: 4, fontSize: 12, border: "none", cursor: "pointer", background: local.useAlgoConfidence ? "#6366f1" : "var(--border-strong)", color: "#fff" }}
                  >
                    Algorithm ({computeAlgoConfidence(local)}%)
                  </button>
                  <button
                    onClick={() => setLocal(p => ({ ...p, useAlgoConfidence: false }))}
                    style={{ padding: "4px 11px", borderRadius: 4, fontSize: 12, border: "none", cursor: "pointer", background: !local.useAlgoConfidence ? "#6366f1" : "var(--border-strong)", color: "#fff" }}
                  >
                    Manual
                  </button>
                </div>
              </div>
              {!local.useAlgoConfidence && (
                <div>
                  <label style={{ fontSize: 11, color: "var(--text-label)", display: "block", marginBottom: 3 }}>
                    Manual: {local.manualConfidence ?? 50}%
                  </label>
                  <input
                    type="range" min={0} max={100} step={5}
                    value={local.manualConfidence ?? 50}
                    onChange={e => setLocal(p => ({ ...p, manualConfidence: parseInt(e.target.value) }))}
                    style={{ width: 130 }}
                  />
                </div>
              )}
              <div>
                <label style={{ fontSize: 11, color: "var(--text-label)", display: "block", marginBottom: 3 }}>Meeting Booked</label>
                <input
                  type="checkbox"
                  checked={local.meetingBooked || false}
                  onChange={e => setLocal(p => ({ ...p, meetingBooked: e.target.checked }))}
                  style={{ transform: "scale(1.3)", cursor: "pointer", marginTop: 6, display: "block" }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "#4ade80", display: "block", marginBottom: 3, fontWeight: 600 }}>Officially Closed</label>
                <input
                  type="checkbox"
                  checked={local.closedWon || false}
                  onChange={e => setLocal(p => ({ ...p, closedWon: e.target.checked }))}
                  style={{ transform: "scale(1.3)", cursor: "pointer", marginTop: 6, display: "block", accentColor: "#4ade80" }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "var(--text-label)", display: "block", marginBottom: 3 }}>Touches</label>
                <input
                  type="number" min={0}
                  value={local.touchCount || 0}
                  onChange={e => setLocal(p => ({ ...p, touchCount: parseInt(e.target.value) || 0 }))}
                  style={{ ...inp, width: 70 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "var(--text-label)", display: "block", marginBottom: 3 }}>Last Activity</label>
                <input
                  type="date"
                  value={local.lastActivityDate || ""}
                  onChange={e => setLocal(p => ({ ...p, lastActivityDate: e.target.value }))}
                  style={{ ...inp }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "#a78bfa", display: "block", marginBottom: 3 }}>Demo Date</label>
                <input
                  type="date"
                  value={local.demoDate || ""}
                  onChange={e => setLocal(p => ({ ...p, demoDate: e.target.value }))}
                  style={{ ...inp }}
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label style={{ fontSize: 11, color: "var(--text-label)", display: "block", marginBottom: 3 }}>Notes</label>
              <textarea
                value={local.notes || ""}
                onChange={e => setLocal(p => ({ ...p, notes: e.target.value }))}
                rows={2}
                style={{ ...inp, width: "100%", resize: "vertical" }}
              />
            </div>

            {/* HubSpot contacts + notes (only for HS-linked deals) */}
            {deal.hubspotId && (
              <div style={{ borderTop: "1px solid #334155", paddingTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                {/* Contacts */}
                <div>
                  <div style={{ fontSize: 11, color: "#60a5fa", fontWeight: 600, marginBottom: 6, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    HubSpot Contacts {!hsLoading && hsContacts.length > 0 && `(${hsContacts.length})`}
                  </div>
                  {hsLoading ? (
                    <div style={{ fontSize: 11, color: "#475569" }}>Loading…</div>
                  ) : hsContacts.length === 0 ? (
                    <div style={{ fontSize: 11, color: "#475569" }}>No contacts associated</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {hsContacts.map(c => {
                        const cp = c.properties || {};
                        const name = [cp.firstname, cp.lastname].filter(Boolean).join(" ") || "Unknown";
                        return (
                          <div key={c.id} style={{ background: "var(--surface-deep)", border: "1px solid #1e3a5f", borderRadius: 6, padding: "8px 11px" }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-body)" }}>{name}</div>
                            {cp.jobtitle && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{cp.jobtitle}</div>}
                            <div style={{ display: "flex", gap: 12, marginTop: 3, flexWrap: "wrap" }}>
                              {cp.email && <a href={`mailto:${cp.email}`} style={{ fontSize: 11, color: "#818cf8", textDecoration: "none" }}>{cp.email}</a>}
                              {cp.phone && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{cp.phone}</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Notes */}
                <div>
                  <div style={{ fontSize: 11, color: "#60a5fa", fontWeight: 600, marginBottom: 6, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    HubSpot Notes {!hsLoading && hsNotes.length > 0 && `(${hsNotes.length})`}
                  </div>
                  {hsLoading ? (
                    <div style={{ fontSize: 11, color: "#475569" }}>Loading…</div>
                  ) : hsNotes.length === 0 ? (
                    <div style={{ fontSize: 11, color: "#475569" }}>No notes found</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {hsNotes.map(n => {
                        const np = n.properties || {};
                        const body = np.hs_note_body?.replace(/<[^>]*>/g, "") || "";
                        const ts = np.hs_timestamp ? new Date(np.hs_timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
                        return (
                          <div key={n.id} style={{ background: "var(--surface-deep)", border: "1px solid #334155", borderRadius: 6, padding: "8px 11px" }}>
                            {ts && <div style={{ fontSize: 10, color: "#475569", marginBottom: 4 }}>{ts}</div>}
                            <div style={{ fontSize: 12, color: "var(--text-label)", lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                              {body || <span style={{ color: "var(--border-strong)" }}>(empty)</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={save} style={{ padding: "5px 16px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 13 }}>Save</button>
              <button onClick={() => { setLocal(deal); setEditing(false); }} style={{ padding: "5px 16px", background: "var(--border-strong)", color: "var(--text-body)", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 13 }}>Cancel</button>
              <button onClick={() => onDelete(deal.id)} style={{ padding: "5px 16px", background: "#7f1d1d", color: "#fca5a5", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 13, marginLeft: "auto" }}>Delete</button>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr
      onClick={() => setEditing(true)}
      style={{ cursor: "pointer", opacity: local.closedWon ? 0.75 : 1 }}
      onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.03)"}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
    >
      <td style={cell}>
        <div style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
          {local.name || "Unnamed"}
          {local.closedWon && (
            <span style={{ fontSize: 10, background: "#14532d", color: "#4ade80", borderRadius: 3, padding: "1px 5px", border: "1px solid #166534", fontWeight: 700, letterSpacing: "0.04em" }}>WON</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 4, marginTop: 3, flexWrap: "wrap" }}>
          {productMeta && (
            local.product === "uniqlearn" ? (
              <img src={uniqlearnLogo} alt="UniqLearn" style={{ height: 20, objectFit: "contain" }} />
            ) : local.product === "uniqpath" ? (
              <img src={uniqpathLogo} alt="UniqPath" style={{ height: 20, objectFit: "contain" }} />
            ) : (
              <span style={{ fontSize: 10, background: productMeta.color + "22", color: productMeta.color, borderRadius: 3, padding: "1px 5px", border: `1px solid ${productMeta.color}44` }}>
                {productMeta.label}
              </span>
            )
          )}
          {local.state && (
            <span style={{ fontSize: 10, color: "var(--text-muted)", padding: "1px 0" }}>{local.state}</span>
          )}
          {local.source === "hubspot" && (
            <span style={{ fontSize: 10, background: "#0369a1", color: "#bae6fd", borderRadius: 3, padding: "1px 5px" }}>HS</span>
          )}
          {local.funnelType === "outbound" && (
            <span style={{ fontSize: 10, background: "#78350f", color: "#fcd34d", borderRadius: 3, padding: "1px 5px", border: "1px solid #92400e" }}>Outbound</span>
          )}
          {local.funnelType === "event" && (
            <span style={{ fontSize: 10, background: "#0c4a6e", color: "#7dd3fc", borderRadius: 3, padding: "1px 5px", border: "1px solid #0369a1" }}>
              {events.find(e => e.id === local.funnelEventId)?.name || "Event"}
            </span>
          )}
          {local.funnelType === "podcast" && (
            <span style={{ fontSize: 10, background: "#3b0764", color: "#d8b4fe", borderRadius: 3, padding: "1px 5px", border: "1px solid #6d28d9" }}>Podcast</span>
          )}
        </div>
        {local.contactName && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{local.contactName}</div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
          {deal.createdAt && (
            <span style={{ fontSize: 10, color: "#64748b" }}>Added {fmtCreatedAt(deal.createdAt)}</span>
          )}
          {local.demoDate && (
            <span style={{ fontSize: 10, color: "#a78bfa" }}>
              Demo {new Date(local.demoDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
          )}
        </div>
      </td>
      <td style={{ ...cell, textAlign: "right", color: local.closedWon ? "#4ade80" : "var(--text-body)" }}>{formatCurrency(local.value)}</td>
      <td style={{ ...cell, textAlign: "center" }}>
        {local.closedWon
          ? <span style={{ fontSize: 11, color: "#4ade80" }}>closed</span>
          : <>
              <span style={{ color: confidenceColor, fontWeight: 600 }}>{effective}%</span>
              {local.useAlgoConfidence && <span style={{ fontSize: 10, color: "#818cf8", marginLeft: 4 }}>auto</span>}
            </>
        }
      </td>
      <td style={{ ...cell, textAlign: "right", color: local.closedWon ? "var(--text-muted)" : "#a5f3fc", fontWeight: 600 }}>
        {local.closedWon ? <span style={{ color: "var(--border-strong)" }}>—</span> : formatCurrency(adjustedValue)}
      </td>
      <td style={{ ...cell, textAlign: "center", color: "var(--text-muted)" }}>
        {local.touchCount > 0 ? local.touchCount : <span style={{ color: "var(--border-strong)" }}>—</span>}
      </td>
      <td style={{ ...cell, color: "var(--text-muted)", fontSize: 12, maxWidth: 200 }}>
        {local.notes
          ? (local.notes.length > 45 ? local.notes.slice(0, 45) + "…" : local.notes)
          : <span style={{ color: "var(--border-strong)" }}>—</span>}
      </td>
    </tr>
  );
}

// ─── HubSpotDealPicker ────────────────────────────────────────────────────────
function HubSpotDealPicker({ hsDeals, hsPipelines, onSelect, onBack }) {
  const [search, setSearch] = useState("");

  // Build lookup maps
  const pipelineMap = {};
  const stageMap = {};
  (hsPipelines || []).forEach(p => {
    pipelineMap[p.id] = p.label;
    (p.stages || []).forEach(s => {
      stageMap[s.id] = s.label;
    });
  });

  // Filter to pilots + renewal pipelines if they exist
  const targetIds = new Set(
    (hsPipelines || [])
      .filter(p => /pilot|renewal/i.test(p.label || ""))
      .map(p => p.id)
  );

  let filtered = hsDeals || [];
  if (targetIds.size > 0) {
    filtered = filtered.filter(d => targetIds.has(d.properties?.pipeline));
  }
  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter(d =>
      (d.properties?.dealname || "").toLowerCase().includes(q) ||
      (pipelineMap[d.properties?.pipeline] || "").toLowerCase().includes(q)
    );
  }

  const hdr = { padding: "7px 10px", fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "left", borderBottom: "1px solid #334155" };
  const cell = { padding: "8px 10px", fontSize: 13, borderBottom: "1px solid rgba(255,255,255,0.04)", color: "var(--text-body)", verticalAlign: "middle" };

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <button
          onClick={onBack}
          style={{ padding: "5px 12px", background: "var(--border-strong)", color: "var(--text-body)", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 13 }}
        >
          ← Back
        </button>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search deals…"
          autoFocus
          style={{ flex: 1, background: "var(--surface-deep)", border: "1px solid #334155", borderRadius: 5, color: "var(--text-body)", padding: "6px 10px", fontSize: 13 }}
        />
        <span style={{ fontSize: 12, color: "#475569", whiteSpace: "nowrap" }}>{filtered.length} deal{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {filtered.length === 0 ? (
        <p style={{ color: "#475569", fontSize: 13, textAlign: "center", padding: "24px 0" }}>
          {(hsDeals || []).length === 0
            ? "No HubSpot deals loaded. Connect HubSpot first."
            : "No deals found matching your search."}
        </p>
      ) : (
        <div style={{ maxHeight: 340, overflowY: "auto", borderRadius: 6, border: "1px solid #334155" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, background: "var(--surface)" }}>
              <tr>
                <th style={hdr}>Deal Name</th>
                <th style={hdr}>Pipeline</th>
                <th style={hdr}>Stage</th>
                <th style={{ ...hdr, textAlign: "right" }}>Amount</th>
                <th style={hdr}>Close Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => {
                const pipelineLabel = pipelineMap[d.properties?.pipeline] || d.properties?.pipeline || "—";
                const stageLabel = stageMap[d.properties?.dealstage] || d.properties?.dealstage || "—";
                const amount = parseFloat(d.properties?.amount) || 0;
                const closedate = d.properties?.closedate;
                return (
                  <tr
                    key={d.id}
                    onClick={() => onSelect(d)}
                    style={{ cursor: "pointer" }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(99,102,241,0.1)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <td style={{ ...cell, fontWeight: 500 }}>{d.properties?.dealname || "Unnamed"}</td>
                    <td style={{ ...cell, color: "var(--text-label)" }}>{pipelineLabel}</td>
                    <td style={{ ...cell, color: "var(--text-label)" }}>{stageLabel}</td>
                    <td style={{ ...cell, textAlign: "right", color: "#a5f3fc" }}>{amount > 0 ? formatCurrency(amount) : "—"}</td>
                    <td style={{ ...cell, color: "var(--text-muted)" }}>
                      {closedate
                        ? new Date(closedate).toLocaleDateString("en-US", { month: "short", year: "numeric" })
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── AddDealModal ─────────────────────────────────────────────────────────────
function AddDealModal({ onAdd, onClose, hsDeals, hsPipelines }) {
  const [mode, setMode] = useState(null); // null | "manual" | "hubspot"
  const [hsStep, setHsStep] = useState("pick"); // "pick" | "form"
  const [selectedHsDeal, setSelectedHsDeal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [form, setForm] = useState({
    name: "", contactName: "", contactInfo: "",
    value: 10000, product: "uniqlearn", state: "",
    bucket: "active", expectedCloseMonth: MONTH_OPTIONS[2]?.value || "",
    useAlgoConfidence: false, manualConfidence: 30,
    meetingBooked: false, touchCount: 0,
    lastActivityDate: "", demoDate: "", notes: "",
  });

  function handleSelectHsDeal(d) {
    const closedate = d.properties?.closedate;
    let closeMonth = form.expectedCloseMonth;
    if (closedate) {
      const dt = new Date(closedate);
      closeMonth = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    }
    setForm(p => ({
      ...p,
      name: d.properties?.dealname || "",
      value: parseFloat(d.properties?.amount) || 10000,
      expectedCloseMonth: closeMonth,
    }));
    setSelectedHsDeal(d);
    setHsStep("form");
  }

  async function handleAdd() {
    if (!form.name.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onAdd({
        ...form,
        source: mode === "hubspot" && selectedHsDeal ? "hubspot" : "manual",
        hubspotId: selectedHsDeal?.id || null,
      });
      onClose();
    } catch (err) {
      setSaveError(err.message || "Failed to save. Check your connection.");
      setSaving(false);
    }
  }

  const overlay = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
    zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
  };
  const card = {
    background: "var(--surface)", border: "1px solid #334155", borderRadius: 12,
    padding: 28, width: 580, maxWidth: "96vw", maxHeight: "92vh", overflowY: "auto",
  };
  const lbl = { fontSize: 12, color: "var(--text-label)", display: "block", marginBottom: 4 };
  const inp = {
    background: "var(--surface-deep)", border: "1px solid #334155", borderRadius: 5,
    color: "var(--text-body)", padding: "6px 10px", fontSize: 14, width: "100%", boxSizing: "border-box",
  };

  // ── Mode picker screen ────────────────────────────────────────────────────
  if (!mode) {
    return (
      <div style={overlay} onClick={onClose}>
        <div style={{ ...card, width: 480 }} onClick={e => e.stopPropagation()}>
          <h3 style={{ color: "var(--text)", margin: "0 0 6px", fontSize: 17, fontWeight: 600 }}>Add to Pipeline</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "0 0 24px" }}>How would you like to add this deal?</p>
          <div style={{ display: "flex", gap: 14 }}>
            <button
              onClick={() => setMode("manual")}
              style={{
                flex: 1, padding: "20px 16px", background: "var(--surface-deep)", border: "2px solid #334155",
                borderRadius: 10, cursor: "pointer", textAlign: "center", transition: "border-color 0.15s",
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "#6366f1"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border-strong)"}
            >
              <div style={{ fontSize: 28, marginBottom: 10 }}>✏️</div>
              <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 15, marginBottom: 6 }}>Manual Add</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>Enter deal details from scratch</div>
            </button>
            <button
              onClick={() => setMode("hubspot")}
              disabled={!hsDeals || hsDeals.length === 0}
              style={{
                flex: 1, padding: "20px 16px", background: "var(--surface-deep)",
                border: `2px solid ${hsDeals?.length > 0 ? "var(--border-strong)" : "var(--surface)"}`,
                borderRadius: 10, cursor: hsDeals?.length > 0 ? "pointer" : "not-allowed",
                textAlign: "center", opacity: hsDeals?.length > 0 ? 1 : 0.45,
              }}
              onMouseEnter={e => { if (hsDeals?.length > 0) e.currentTarget.style.borderColor = "#0ea5e9"; }}
              onMouseLeave={e => { if (hsDeals?.length > 0) e.currentTarget.style.borderColor = "var(--border-strong)"; }}
            >
              <div style={{ fontSize: 28, marginBottom: 10 }}>🔗</div>
              <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 15, marginBottom: 6 }}>Choose from HubSpot</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                {hsDeals?.length > 0
                  ? `Pick from ${hsDeals.length} deals in pilots & renewals`
                  : "Connect HubSpot to enable"}
              </div>
            </button>
          </div>
          <div style={{ marginTop: 20, textAlign: "right" }}>
            <button onClick={onClose} style={{ padding: "7px 16px", background: "var(--border-strong)", color: "var(--text-body)", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 13 }}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  // ── HubSpot deal picker ───────────────────────────────────────────────────
  if (mode === "hubspot" && hsStep === "pick") {
    return (
      <div style={overlay} onClick={onClose}>
        <div style={{ ...card, width: 740 }} onClick={e => e.stopPropagation()}>
          <h3 style={{ color: "var(--text)", margin: "0 0 18px", fontSize: 17, fontWeight: 600 }}>Choose from HubSpot</h3>
          <HubSpotDealPicker
            hsDeals={hsDeals}
            hsPipelines={hsPipelines}
            onSelect={handleSelectHsDeal}
            onBack={() => setMode(null)}
          />
        </div>
      </div>
    );
  }

  // ── Deal form (manual or post-HS-selection) ───────────────────────────────
  return (
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <button
            onClick={() => mode === "hubspot" ? setHsStep("pick") : setMode(null)}
            style={{ padding: "4px 10px", background: "var(--border-strong)", color: "var(--text-label)", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 13 }}
          >
            ←
          </button>
          <h3 style={{ color: "var(--text)", margin: 0, fontSize: 16, fontWeight: 600 }}>
            {mode === "hubspot" && selectedHsDeal
              ? `Add from HubSpot: ${selectedHsDeal.properties?.dealname || "Deal"}`
              : "Manual Add"}
          </h3>
        </div>

        {/* Deal name + contract size */}
        <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
          <div style={{ flex: 2 }}>
            <label style={lbl}>Deal Name *</label>
            <input
              style={inp} value={form.name} autoFocus
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Greece Central SD"
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Contract Size ($)</label>
            <input
              type="number" style={inp} value={form.value}
              onChange={e => setForm(p => ({ ...p, value: parseFloat(e.target.value) || 0 }))}
            />
          </div>
        </div>

        {/* Contact name + contact info */}
        <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Contact Name</label>
            <input
              style={inp} value={form.contactName}
              onChange={e => setForm(p => ({ ...p, contactName: e.target.value }))}
              placeholder="e.g. Jane Smith"
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Contact Info</label>
            <input
              style={inp} value={form.contactInfo}
              onChange={e => setForm(p => ({ ...p, contactInfo: e.target.value }))}
              placeholder="email or phone"
            />
          </div>
        </div>

        {/* Product + State + Close Month */}
        <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Product</label>
            <select
              style={inp} value={form.product}
              onChange={e => setForm(p => ({ ...p, product: e.target.value }))}
            >
              {PRODUCTS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={lbl}>State</label>
            <select
              style={inp} value={form.state}
              onChange={e => setForm(p => ({ ...p, state: e.target.value }))}
            >
              <option value="">— Select —</option>
              {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Expected Close Month</label>
            <select
              style={inp} value={form.expectedCloseMonth}
              onChange={e => setForm(p => ({ ...p, expectedCloseMonth: e.target.value }))}
            >
              <option value="">None</option>
              {MONTH_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        </div>

        {/* Bucket + Confidence */}
        <div style={{ display: "flex", gap: 14, marginBottom: 14, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Bucket</label>
            <select style={inp} value={form.bucket} onChange={e => setForm(p => ({ ...p, bucket: e.target.value }))}>
              {BUCKETS.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Confidence Mode</label>
            <div style={{ display: "flex", gap: 6, marginBottom: form.useAlgoConfidence ? 0 : 6 }}>
              <button
                onClick={() => setForm(p => ({ ...p, useAlgoConfidence: false }))}
                style={{ flex: 1, padding: "5px 0", borderRadius: 4, fontSize: 12, border: "none", cursor: "pointer", background: !form.useAlgoConfidence ? "#6366f1" : "var(--border-strong)", color: "#fff" }}
              >
                Manual
              </button>
              <button
                onClick={() => setForm(p => ({ ...p, useAlgoConfidence: true }))}
                style={{ flex: 1, padding: "5px 0", borderRadius: 4, fontSize: 12, border: "none", cursor: "pointer", background: form.useAlgoConfidence ? "#6366f1" : "var(--border-strong)", color: "#fff" }}
              >
                Algorithm
              </button>
            </div>
            {!form.useAlgoConfidence && (
              <div>
                <input
                  type="range" min={0} max={100} step={5} value={form.manualConfidence}
                  onChange={e => setForm(p => ({ ...p, manualConfidence: parseInt(e.target.value) }))}
                  style={{ width: "100%", marginTop: 4 }}
                />
                <span style={{ color: "var(--text-body)", fontSize: 12 }}>{form.manualConfidence}%</span>
              </div>
            )}
          </div>
          <div style={{ paddingTop: 18 }}>
            <label style={{ ...lbl, marginBottom: 10 }}>Mtg Booked</label>
            <input
              type="checkbox" checked={form.meetingBooked}
              onChange={e => setForm(p => ({ ...p, meetingBooked: e.target.checked }))}
              style={{ transform: "scale(1.3)", cursor: "pointer", display: "block" }}
            />
          </div>
        </div>

        {/* Demo Date */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ ...lbl, color: "#a78bfa" }}>Demo Date</label>
          <input
            type="date" style={{ ...inp, maxWidth: 200 }}
            value={form.demoDate || ""}
            onChange={e => setForm(p => ({ ...p, demoDate: e.target.value }))}
          />
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 22 }}>
          <label style={lbl}>Notes</label>
          <textarea
            rows={2} style={{ ...inp, resize: "vertical" }} value={form.notes}
            onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
            placeholder="e.g. Met at FETC, awaiting budget approval…"
          />
        </div>

        {/* Actions */}
        {saveError && (
          <div style={{ marginBottom: 12, padding: "8px 12px", background: "#450a0a", border: "1px solid #991b1b", borderRadius: 6, color: "#fca5a5", fontSize: 13 }}>
            {saveError}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} disabled={saving} style={{ padding: "7px 16px", background: "var(--border-strong)", color: "var(--text-body)", border: "none", borderRadius: 5, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.5 : 1 }}>Cancel</button>
          <button
            onClick={handleAdd}
            disabled={!form.name.trim() || saving}
            style={{
              padding: "7px 20px", border: "none", borderRadius: 5, fontWeight: 600, fontSize: 14,
              background: (!form.name.trim() || saving) ? "#3730a3" : "#6366f1",
              color: "#fff", cursor: (!form.name.trim() || saving) ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Saving…" : "Add to Pipeline"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MonthByMonthDeals ────────────────────────────────────────────────────────
function MonthByMonthDeals({ deals, onUpdate, onDelete, events = [], token }) {
  const [collapsed, setCollapsed] = useState({});

  const now = new Date();
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Group deals by close month
  const monthGroups = {};
  const unscheduled = [];
  deals.forEach(deal => {
    if (deal.expectedCloseMonth) {
      if (!monthGroups[deal.expectedCloseMonth]) monthGroups[deal.expectedCloseMonth] = [];
      monthGroups[deal.expectedCloseMonth].push(deal);
    } else {
      unscheduled.push(deal);
    }
  });

  // Ensure all months from Jan of the current year up to (but not including) the current month
  // are included even if they have no deals, so past months are always visible.
  const currentYear = now.getFullYear();
  const currentMonthNum = now.getMonth(); // 0-indexed
  for (let m = 0; m < currentMonthNum; m++) {
    const key = `${currentYear}-${String(m + 1).padStart(2, "0")}`;
    if (!monthGroups[key]) monthGroups[key] = [];
  }

  const sortedMonths = Object.keys(monthGroups).sort();
  const maxAdj = Math.max(
    ...sortedMonths.map(m =>
      monthGroups[m].filter(d => !d.closedWon).reduce((s, d) => s + (d.value || 0) * (getEffectiveConfidence(d) / 100), 0)
    ),
    unscheduled.filter(d => !d.closedWon).reduce((s, d) => s + (d.value || 0) * (getEffectiveConfidence(d) / 100), 0),
    1
  );

  const tblHdr = { padding: "6px 10px", fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" };

  function renderMonthSection(key, sectionDeals, label, isPast) {
    const openDeals = sectionDeals.filter(d => !d.closedWon);
    const pipeline = openDeals.reduce((s, d) => s + (d.value || 0), 0);
    const adjusted = openDeals.reduce((s, d) => s + (d.value || 0) * (getEffectiveConfidence(d) / 100), 0);
    const closedTotal = sectionDeals.filter(d => d.closedWon).reduce((s, d) => s + (d.value || 0), 0);
    const barW = adjusted > 0 ? Math.round((adjusted / maxAdj) * 100) : 0;
    const isCurrentMonth = key === thisMonthKey;
    const isCollapsed = collapsed[key] ?? (isPast && key !== thisMonthKey);

    const borderColor = isCurrentMonth ? "#4f46e5" : "var(--border-strong)";
    const headerBg = isCurrentMonth ? "rgba(99,102,241,0.08)" : "transparent";

    return (
      <div key={key} style={{ marginBottom: 10, background: "var(--surface)", borderRadius: 10, border: `1px solid ${borderColor}`, overflow: "hidden" }}>
        <div
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", cursor: "pointer", userSelect: "none", background: headerBg }}
          onClick={() => setCollapsed(p => ({ ...p, [key]: !isCollapsed }))}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
            <span style={{ color: "#475569", fontSize: 11, flexShrink: 0 }}>{isCollapsed ? "▶" : "▼"}</span>
            <span style={{ fontWeight: 600, fontSize: 14, color: isCurrentMonth ? "#a5b4fc" : isPast ? "var(--text-muted)" : "var(--text)", flexShrink: 0, minWidth: 120 }}>
              {label}
              {isCurrentMonth && <span style={{ fontSize: 10, color: "#6366f1", marginLeft: 6 }}>▶ now</span>}
              {isPast && key !== "unscheduled" && !isCurrentMonth && <span style={{ fontSize: 10, color: "#475569", marginLeft: 6 }}>past</span>}
            </span>
            <span style={{ fontSize: 12, color: "#475569", flexShrink: 0 }}>{sectionDeals.length} deal{sectionDeals.length !== 1 ? "s" : ""}</span>
            {barW > 0 && (
              <div style={{ flex: 1, maxWidth: 180, height: 5, background: "var(--surface-deep)", borderRadius: 3, overflow: "hidden", marginLeft: 4 }}>
                <div style={{
                  width: `${barW}%`, height: "100%", borderRadius: 3,
                  background: isCurrentMonth
                    ? "linear-gradient(90deg, #6366f1, #a5b4fc)"
                    : isPast ? "#475569" : "linear-gradient(90deg, #0369a1, #38bdf8)",
                }} />
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 24, fontSize: 13, flexShrink: 0 }}>
            {closedTotal > 0 && (
              <span style={{ color: "#4ade80", fontWeight: 600 }}>{formatCurrency(closedTotal)} closed</span>
            )}
            <span style={{ color: "var(--text-muted)" }}>{pipeline > 0 ? formatCurrency(pipeline) : "—"}</span>
            <span style={{ color: isCurrentMonth ? "#a5b4fc" : "#a5f3fc", fontWeight: 600, minWidth: 60, textAlign: "right" }}>
              {adjusted > 0 ? formatCurrency(adjusted) : "—"}
            </span>
          </div>
        </div>

        {!isCollapsed && (
          sectionDeals.length === 0 ? (
            <p style={{ color: "var(--border-strong)", fontSize: 13, textAlign: "center", padding: "14px 0", margin: 0, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              No deals scheduled here.
            </p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderTop: "1px solid rgba(255,255,255,0.05)", borderBottom: "1px solid #334155" }}>
                  <th style={{ ...tblHdr, textAlign: "left" }}>Customer</th>
                  <th style={{ ...tblHdr, textAlign: "right" }}>Value</th>
                  <th style={{ ...tblHdr, textAlign: "center" }}>Confidence</th>
                  <th style={{ ...tblHdr, textAlign: "right" }}>Adjusted</th>
                  <th style={{ ...tblHdr, textAlign: "center" }}>Touches</th>
                  <th style={{ ...tblHdr, textAlign: "left" }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {sectionDeals.map(deal => (
                  <DealRow key={deal.id} deal={deal} onUpdate={onUpdate} onDelete={onDelete} events={events} token={token} />
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                  <td style={{ padding: "7px 10px", color: "#475569", fontSize: 12, fontWeight: 600 }}>Subtotal</td>
                  <td style={{ padding: "7px 10px", color: "var(--text-muted)", fontSize: 13, textAlign: "right" }}>{formatCurrency(pipeline)}</td>
                  <td></td>
                  <td style={{ padding: "7px 10px", color: "#a5f3fc", fontSize: 13, textAlign: "right", fontWeight: 600 }}>{formatCurrency(adjusted)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          )
        )}
      </div>
    );
  }

  if (deals.length === 0) {
    return (
      <div style={{ background: "var(--surface)", borderRadius: 10, border: "1px solid #334155", padding: "32px 20px", textAlign: "center" }}>
        <p style={{ color: "#475569", fontSize: 14, margin: 0 }}>No deals yet. Click "+ Add to Pipeline" to get started, or import the CSV data.</p>
      </div>
    );
  }

  return (
    <div>
      {sortedMonths.map(monthKey => {
        const label = new Date(monthKey + "-02").toLocaleDateString("en-US", { month: "long", year: "numeric" });
        const isPast = monthKey < thisMonthKey;
        return renderMonthSection(monthKey, monthGroups[monthKey], label, isPast);
      })}
      {unscheduled.length > 0 && renderMonthSection("unscheduled", unscheduled, "Unscheduled", false)}
    </div>
  );
}

// ─── Events Section ───────────────────────────────────────────────────────────
function EventsSection({ events, onAdd, onDelete }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", date: "", peopleMet: 0, convertedToMeeting: 0, dealsWon: 0, dealValue: 0, notes: "" });

  function handleAdd() {
    if (!form.name.trim()) return;
    onAdd({ ...form });
    setForm({ name: "", date: "", peopleMet: 0, convertedToMeeting: 0, dealsWon: 0, dealValue: 0, notes: "" });
    setShowForm(false);
  }

  const totalMet = events.reduce((s, e) => s + (e.peopleMet || 0), 0);
  const totalConv = events.reduce((s, e) => s + (e.convertedToMeeting || 0), 0);
  const totalDealsWon = events.reduce((s, e) => s + (e.dealsWon || 0), 0);
  const totalDealValue = events.reduce((s, e) => s + (e.dealValue || 0), 0);
  const overallRate = totalMet > 0 ? ((totalConv / totalMet) * 100).toFixed(1) + "%" : "—";

  const inp = { background: "var(--surface-deep)", border: "1px solid #334155", borderRadius: 5, color: "var(--text-body)", padding: "5px 8px", fontSize: 13 };
  const hdr = { padding: "6px 10px", fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" };

  return (
    <div style={{ background: "var(--surface)", borderRadius: 10, border: "1px solid #334155", padding: 20, marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <h3 style={{ color: "var(--text)", margin: 0, fontSize: 15, fontWeight: 600 }}>Event Tracking</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 12, margin: "4px 0 0" }}>
            {events.length} events · {totalMet} contacts · {totalConv} → meeting · {overallRate} conv. · {totalDealsWon} deals closed · {formatCurrency(totalDealValue)}
          </p>
        </div>
        <button onClick={() => setShowForm(s => !s)} style={{ padding: "5px 14px", background: showForm ? "var(--border-strong)" : "#6366f1", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 13 }}>
          {showForm ? "Cancel" : "+ Add Event"}
        </button>
      </div>

      {showForm && (
        <div style={{ background: "var(--surface-deep)", borderRadius: 8, padding: 16, marginBottom: 14, border: "1px solid #1e293b" }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--text-label)", display: "block", marginBottom: 3 }}>Event Name</label>
              <input style={{ ...inp, width: 160 }} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. FETC 2026" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--text-label)", display: "block", marginBottom: 3 }}>Date</label>
              <input type="date" style={inp} value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--text-label)", display: "block", marginBottom: 3 }}>People Met</label>
              <input type="number" min={0} style={{ ...inp, width: 85 }} value={form.peopleMet} onChange={e => setForm(p => ({ ...p, peopleMet: parseInt(e.target.value) || 0 }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--text-label)", display: "block", marginBottom: 3 }}>→ Meeting</label>
              <input type="number" min={0} style={{ ...inp, width: 85 }} value={form.convertedToMeeting} onChange={e => setForm(p => ({ ...p, convertedToMeeting: parseInt(e.target.value) || 0 }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--text-label)", display: "block", marginBottom: 3 }}>Deals Closed</label>
              <input type="number" min={0} style={{ ...inp, width: 85 }} value={form.dealsWon} onChange={e => setForm(p => ({ ...p, dealsWon: parseInt(e.target.value) || 0 }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--text-label)", display: "block", marginBottom: 3 }}>Deal Value ($)</label>
              <input type="number" min={0} style={{ ...inp, width: 110 }} value={form.dealValue} onChange={e => setForm(p => ({ ...p, dealValue: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--text-label)", display: "block", marginBottom: 3 }}>Notes</label>
              <input style={{ ...inp, width: 180 }} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional" />
            </div>
          </div>
          <button onClick={handleAdd} disabled={!form.name.trim()} style={{ padding: "5px 16px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 13 }}>Add</button>
        </div>
      )}

      {events.length === 0 ? (
        <p style={{ color: "#475569", fontSize: 13, textAlign: "center", padding: "16px 0", margin: 0 }}>No events logged yet. Track conferences and their conversion rates here.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #334155" }}>
              {["Event", "Date", "Met", "→ Mtg", "Conv%", "Closed", "Value", "Notes", ""].map(h => (
                <th key={h} style={{ ...hdr, textAlign: h === "Met" || h === "→ Mtg" || h === "Conv%" || h === "Closed" || h === "Value" ? "center" : "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.map(ev => {
              const rate = ev.peopleMet > 0 ? ((ev.convertedToMeeting / ev.peopleMet) * 100).toFixed(1) + "%" : "—";
              const rateGood = ev.peopleMet > 0 && (ev.convertedToMeeting / ev.peopleMet) >= 0.15;
              return (
                <tr key={ev.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "8px 10px", color: "var(--text-body)", fontSize: 13, fontWeight: 500 }}>{ev.name}</td>
                  <td style={{ padding: "8px 10px", color: "var(--text-label)", fontSize: 13 }}>
                    {ev.date ? new Date(ev.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                  </td>
                  <td style={{ padding: "8px 10px", color: "var(--text-body)", fontSize: 13, textAlign: "center" }}>{ev.peopleMet}</td>
                  <td style={{ padding: "8px 10px", color: "#a5f3fc", fontSize: 13, textAlign: "center" }}>{ev.convertedToMeeting}</td>
                  <td style={{ padding: "8px 10px", fontSize: 13, textAlign: "center", color: rateGood ? "#4ade80" : "#fbbf24" }}>{rate}</td>
                  <td style={{ padding: "8px 10px", color: "#4ade80", fontSize: 13, textAlign: "center" }}>{ev.dealsWon || 0}</td>
                  <td style={{ padding: "8px 10px", color: "#a5f3fc", fontSize: 13, textAlign: "center" }}>{ev.dealValue ? formatCurrency(ev.dealValue) : "—"}</td>
                  <td style={{ padding: "8px 10px", color: "var(--text-muted)", fontSize: 12 }}>{ev.notes || "—"}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>
                    <button onClick={() => onDelete(ev.id)} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 16, lineHeight: 1 }} title="Delete">×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Outbound Actuals ─────────────────────────────────────────────────────────
function OutboundActuals({ actuals, onAdd, onDelete }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ weekOf: "", touches: 0, meetingsBooked: 0, meetingsHeld: 0, dealsCreated: 0, notes: "" });

  function handleAdd() {
    if (!form.weekOf) return;
    onAdd({ ...form });
    setForm({ weekOf: "", touches: 0, meetingsBooked: 0, meetingsHeld: 0, dealsCreated: 0, notes: "" });
    setShowForm(false);
  }

  const totTouches = actuals.reduce((s, a) => s + (a.touches || 0), 0);
  const totBooked  = actuals.reduce((s, a) => s + (a.meetingsBooked || 0), 0);
  const totHeld    = actuals.reduce((s, a) => s + (a.meetingsHeld || 0), 0);
  const totDeals   = actuals.reduce((s, a) => s + (a.dealsCreated || 0), 0);
  const bookRate   = totTouches > 0 ? ((totBooked / totTouches) * 100).toFixed(1) + "%" : "—";
  const showRate   = totBooked  > 0 ? ((totHeld   / totBooked)  * 100).toFixed(1) + "%" : "—";
  const dealRate   = totHeld    > 0 ? ((totDeals  / totHeld)    * 100).toFixed(1) + "%" : "—";

  const inp = { background: "var(--surface-deep)", border: "1px solid #334155", borderRadius: 5, color: "var(--text-body)", padding: "5px 8px", fontSize: 13 };
  const hdr = { padding: "6px 10px", fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" };

  const sorted = [...actuals].sort((a, b) => (b.weekOf || "").localeCompare(a.weekOf || ""));

  return (
    <div style={{ background: "var(--surface)", borderRadius: 10, border: "1px solid #334155", padding: 20, marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <h3 style={{ color: "var(--text)", margin: 0, fontSize: 15, fontWeight: 600 }}>Outbound Actuals</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 12, margin: "4px 0 0" }}>
            {totTouches} touches → {totBooked} booked ({bookRate}) → {totHeld} held ({showRate}) → {totDeals} deals ({dealRate})
          </p>
        </div>
        <button onClick={() => setShowForm(s => !s)} style={{ padding: "5px 14px", background: showForm ? "var(--border-strong)" : "#6366f1", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 13 }}>
          {showForm ? "Cancel" : "+ Log Week"}
        </button>
      </div>

      {showForm && (
        <div style={{ background: "var(--surface-deep)", borderRadius: 8, padding: 16, marginBottom: 14, border: "1px solid #1e293b" }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--text-label)", display: "block", marginBottom: 3 }}>Week of</label>
              <input type="date" style={inp} value={form.weekOf} onChange={e => setForm(p => ({ ...p, weekOf: e.target.value }))} />
            </div>
            {[["Touches", "touches"], ["Mtgs Booked", "meetingsBooked"], ["Mtgs Held", "meetingsHeld"], ["Deals", "dealsCreated"]].map(([label, key]) => (
              <div key={key}>
                <label style={{ fontSize: 11, color: "var(--text-label)", display: "block", marginBottom: 3 }}>{label}</label>
                <input type="number" min={0} style={{ ...inp, width: 85 }} value={form[key]} onChange={e => setForm(p => ({ ...p, [key]: parseInt(e.target.value) || 0 }))} />
              </div>
            ))}
            <div>
              <label style={{ fontSize: 11, color: "var(--text-label)", display: "block", marginBottom: 3 }}>Notes</label>
              <input style={{ ...inp, width: 170 }} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional" />
            </div>
          </div>
          <button onClick={handleAdd} disabled={!form.weekOf} style={{ padding: "5px 16px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 13 }}>Log</button>
        </div>
      )}

      {actuals.length === 0 ? (
        <p style={{ color: "#475569", fontSize: 13, textAlign: "center", padding: "16px 0", margin: 0 }}>No activity logged yet. Track weekly outbound numbers to measure real conversion rates.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #334155" }}>
              {["Week of", "Touches", "Booked", "Book%", "Held", "Show%", "Deals", "Deal%", "Notes", ""].map(h => (
                <th key={h} style={{ ...hdr, textAlign: ["Touches","Booked","Book%","Held","Show%","Deals","Deal%"].includes(h) ? "center" : "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(a => {
              const bR = a.touches > 0        ? ((a.meetingsBooked / a.touches)        * 100).toFixed(1) + "%" : "—";
              const sR = a.meetingsBooked > 0 ? ((a.meetingsHeld   / a.meetingsBooked) * 100).toFixed(1) + "%" : "—";
              const dR = a.meetingsHeld > 0   ? ((a.dealsCreated   / a.meetingsHeld)   * 100).toFixed(1) + "%" : "—";
              return (
                <tr key={a.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "8px 10px", color: "var(--text-body)", fontSize: 13 }}>
                    {a.weekOf ? new Date(a.weekOf + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                  </td>
                  <td style={{ padding: "8px 10px", color: "var(--text-body)", fontSize: 13, textAlign: "center" }}>{a.touches}</td>
                  <td style={{ padding: "8px 10px", color: "#a5f3fc", fontSize: 13, textAlign: "center" }}>{a.meetingsBooked}</td>
                  <td style={{ padding: "8px 10px", color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>{bR}</td>
                  <td style={{ padding: "8px 10px", color: "#a5f3fc", fontSize: 13, textAlign: "center" }}>{a.meetingsHeld}</td>
                  <td style={{ padding: "8px 10px", color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>{sR}</td>
                  <td style={{ padding: "8px 10px", color: "#4ade80", fontSize: 13, textAlign: "center" }}>{a.dealsCreated}</td>
                  <td style={{ padding: "8px 10px", color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>{dR}</td>
                  <td style={{ padding: "8px 10px", color: "var(--text-muted)", fontSize: 12 }}>{a.notes || "—"}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>
                    <button onClick={() => onDelete(a.id)} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 16, lineHeight: 1 }} title="Delete">×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Main Pipeline Page ───────────────────────────────────────────────────────
export default function PipelinePage({ hsDeals, hsPipelines, hsToken, onHsDealClosed }) {
  const [deals,        setDeals]        = useState([]);
  const [events,       setEvents]       = useState([]);
  const [actuals,      setActuals]      = useState([]);
  const [showAddDeal,  setShowAddDeal]  = useState(false);
  const [syncing,      setSyncing]      = useState(false);
  const [syncMsg,      setSyncMsg]      = useState(null);
  const [importing,    setImporting]    = useState(false);
  const [searchQuery,  setSearchQuery]  = useState("");
  const [productFilter, setProductFilter] = useState("all");
  const [activeTab,    setActiveTab]    = useState("dashboards");
  const [showCloseChart, setShowCloseChart] = useState(true);
  const [showAddedChart, setShowAddedChart] = useState(true);

  // Firestore listeners
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "pipelineDeals"), orderBy("createdAt", "desc")),
      snap => setDeals(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "pipelineEvents"), orderBy("createdAt", "desc")),
      snap => setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "outboundActuals"), orderBy("weekOf", "desc")),
      snap => setActuals(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    return unsub;
  }, []);

  // ── HubSpot → Pipeline Tracker sync ──
  // When hsDeals updates (Refresh or Kanban drag), auto-close matching Firestore deals
  useEffect(() => {
    if (!hsDeals?.length || !deals.length) return;
    const closedHsIds = new Set(
      hsDeals.filter(d => d.properties?.dealstage === "closedwon").map(d => d.id)
    );
    for (const deal of deals) {
      if (deal.hubspotId && closedHsIds.has(deal.hubspotId) && !deal.closedWon) {
        updateDoc(doc(db, "pipelineDeals", deal.id), {
          closedWon: true,
          updatedAt: serverTimestamp(),
        });
      }
    }
  }, [hsDeals]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Deal CRUD ──
  async function addDeal(form) {
    const { source, hubspotId, ...rest } = form;
    await addDoc(collection(db, "pipelineDeals"), {
      source: source || "manual",
      hubspotId: hubspotId || null,
      hubspotStage: null,
      hubspotPipeline: null,
      hubspotStageProbability: null,
      ...rest,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  async function updateDeal(id, data) {
    const { id: _id, ...rest } = data;
    const prevDeal = deals.find(d => d.id === id);

    // Pipeline Tracker → HubSpot: push close when closedWon is newly checked
    if (rest.closedWon && !prevDeal?.closedWon && rest.hubspotId && hsToken) {
      updateDealStage(hsToken, rest.hubspotId, "closedwon")
        .then(() => onHsDealClosed?.(rest.hubspotId))
        .catch(e => console.error("HubSpot close sync failed:", e));
    }

    // Pipeline Tracker → HubSpot: push amount when value changes
    if (rest.hubspotId && hsToken && rest.value != null && rest.value !== prevDeal?.value) {
      updateDealAmount(hsToken, rest.hubspotId, rest.value)
        .catch(e => console.error("HubSpot amount sync failed:", e));
    }

    // Sync event dealsWon / dealValue based on closedWon state changes
    const prevEventId = prevDeal?.funnelType === "event" && prevDeal?.closedWon ? prevDeal.funnelEventId : null;
    const newEventId  = rest.funnelType === "event" && rest.closedWon ? rest.funnelEventId : null;

    const deltas = {};
    if (prevEventId) {
      deltas[prevEventId] = { dealsWon: -1, dealValue: -(prevDeal.value || 0) };
    }
    if (newEventId) {
      if (!deltas[newEventId]) deltas[newEventId] = { dealsWon: 0, dealValue: 0 };
      deltas[newEventId].dealsWon  += 1;
      deltas[newEventId].dealValue += (rest.value || 0);
    }

    const eventUpdates = Object.entries(deltas)
      .filter(([, d]) => d.dealsWon !== 0 || d.dealValue !== 0)
      .map(([eventId, delta]) => {
        const ev = events.find(e => e.id === eventId);
        if (!ev) return Promise.resolve();
        return updateDoc(doc(db, "pipelineEvents", eventId), {
          dealsWon:  Math.max(0, (ev.dealsWon  || 0) + delta.dealsWon),
          dealValue: Math.max(0, (ev.dealValue || 0) + delta.dealValue),
        });
      });

    await Promise.all([
      updateDoc(doc(db, "pipelineDeals", id), { ...rest, updatedAt: serverTimestamp() }),
      ...eventUpdates,
    ]);
  }

  async function deleteDeal(id) {
    if (!window.confirm("Delete this deal?")) return;
    await deleteDoc(doc(db, "pipelineDeals", id));
  }

  // ── Event CRUD ──
  async function addEvent(form) {
    await addDoc(collection(db, "pipelineEvents"), { ...form, createdAt: serverTimestamp() });
  }
  async function deleteEvent(id) {
    await deleteDoc(doc(db, "pipelineEvents", id));
  }

  // ── Outbound CRUD ──
  async function addActual(form) {
    await addDoc(collection(db, "outboundActuals"), { ...form, createdAt: serverTimestamp() });
  }
  async function deleteActual(id) {
    await deleteDoc(doc(db, "outboundActuals", id));
  }

  // ── HubSpot sync ──
  async function syncFromHubSpot() {
    if (!hsDeals || hsDeals.length === 0) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const existingHsIds = new Set(deals.filter(d => d.hubspotId).map(d => d.hubspotId));
      const toAdd = hsDeals.filter(d => !existingHsIds.has(d.id));

      const stageMap = {};
      hsPipelines?.forEach(p => {
        p.stages?.forEach(s => {
          stageMap[s.id] = parseFloat(s.metadata?.probability ?? 0.3);
        });
      });

      if (toAdd.length === 0) {
        setSyncMsg("All HubSpot deals already imported.");
      } else {
        await Promise.all(toAdd.map(d => addDoc(collection(db, "pipelineDeals"), {
          source: "hubspot",
          hubspotId: d.id,
          name: d.properties?.dealname || "Unnamed",
          value: parseFloat(d.properties?.amount) || 0,
          useAlgoConfidence: true,
          manualConfidence: 30,
          notes: "",
          bucket: "untagged",
          expectedCloseMonth: null,
          meetingBooked: false,
          lastActivityDate: null,
          touchCount: 0,
          hubspotStage: d.properties?.dealstage || null,
          hubspotPipeline: d.properties?.pipeline || null,
          hubspotStageProbability: stageMap[d.properties?.dealstage] ?? null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })));
        setSyncMsg(`Imported ${toAdd.length} new deal${toAdd.length !== 1 ? "s" : ""} from HubSpot.`);
      }
    } catch (err) {
      setSyncMsg("Sync error: " + err.message);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 4000);
    }
  }

  // ── CSV Import ──
  async function importCSVData() {
    if (!window.confirm(`Import ${CSV_SEED_DATA.length} deals from the Feb 2026 Sales Projections CSV?\n\nThis will add all deals to Firestore. You can edit or delete them after importing.`)) return;
    setImporting(true);
    setSyncMsg(null);
    try {
      for (let i = 0; i < CSV_SEED_DATA.length; i += 10) {
        const batch = CSV_SEED_DATA.slice(i, i + 10);
        await Promise.all(batch.map(d => addDoc(collection(db, "pipelineDeals"), {
          source: "manual",
          hubspotId: null,
          hubspotStage: null,
          hubspotPipeline: null,
          hubspotStageProbability: null,
          useAlgoConfidence: false,
          touchCount: 0,
          lastActivityDate: null,
          contactName: "",
          contactInfo: "",
          product: "",
          state: "",
          ...d,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })));
      }
      setSyncMsg(`Imported ${CSV_SEED_DATA.length} deals.`);
    } catch (err) {
      setSyncMsg("Import error: " + err.message);
    } finally {
      setImporting(false);
      setTimeout(() => setSyncMsg(null), 5000);
    }
  }

  // ── Summary stats ──
  const openDeals = deals.filter(d => !d.closedWon);
  const closedDeals = deals.filter(d => d.closedWon);
  const totalPipeline = openDeals.reduce((s, d) => s + (d.value || 0), 0);
  const totalAdjusted = openDeals.reduce((s, d) => s + (d.value || 0) * (getEffectiveConfidence(d) / 100), 0);
  const totalClosedWon = closedDeals.reduce((s, d) => s + (d.value || 0), 0);
  const now = new Date();
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const thisMonthAdj = openDeals
    .filter(d => d.expectedCloseMonth === thisMonthKey)
    .reduce((s, d) => s + (d.value || 0) * (getEffectiveConfidence(d) / 100), 0);
  const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonthKey = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}`;
  const nextMonthAdj = openDeals
    .filter(d => d.expectedCloseMonth === nextMonthKey)
    .reduce((s, d) => s + (d.value || 0) * (getEffectiveConfidence(d) / 100), 0);

  // ── Filtered deals (for month view) ──
  const filteredDeals = deals.filter(d => {
    if (searchQuery.trim()) {
      if (!(d.name || "").toLowerCase().includes(searchQuery.toLowerCase())) return false;
    }
    if (productFilter !== "all") {
      if (productFilter === "unassigned") {
        if (d.product && d.product !== "") return false;
      } else {
        if ((d.product || "") !== productFilter) return false;
      }
    }
    return true;
  });

  const PRODUCT_FILTERS = [
    { id: "all",        label: "All" },
    { id: "uniqlearn",  label: "UniqLearn", color: "#0ea5e9" },
    { id: "uniqpath",   label: "UniqPath",  color: "#a855f7" },
    { id: "both",       label: "Both",      color: "#f59e0b" },
    { id: "unassigned", label: "Unassigned", color: "var(--text-muted)" },
  ];

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "28px 28px 60px", background: "var(--bg)", color: "var(--text-body)", minWidth: 0 }}>
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.3px" }}>Pipeline Tracker</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted)" }}>Live deal tracking · month-by-month view · confidence scoring</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {syncMsg && (
            <span style={{ fontSize: 12, color: (syncMsg.startsWith("Sync error") || syncMsg.startsWith("Import error")) ? "#f87171" : "#4ade80", marginRight: 4 }}>
              {syncMsg}
            </span>
          )}
          {deals.length === 0 && (
            <button
              onClick={importCSVData}
              disabled={importing}
              style={{ padding: "7px 14px", background: importing ? "#3730a3" : "#4f46e5", color: "#fff", border: "1px solid #6366f1", borderRadius: 6, cursor: importing ? "not-allowed" : "pointer", fontSize: 13 }}
            >
              {importing ? "Importing…" : `⬇ Import CSV Data (${CSV_SEED_DATA.length})`}
            </button>
          )}
          {hsDeals?.length > 0 && (
            <button
              onClick={syncFromHubSpot}
              disabled={syncing}
              style={{ padding: "7px 14px", background: syncing ? "#1e3a5f" : "#0369a1", color: "#fff", border: "none", borderRadius: 6, cursor: syncing ? "not-allowed" : "pointer", fontSize: 13 }}
            >
              {syncing ? "Syncing…" : `Sync HS (${hsDeals.length})`}
            </button>
          )}
          <button
            onClick={() => setShowAddDeal(true)}
            style={{ padding: "7px 18px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 }}
          >
            + Add to Pipeline
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: "flex", gap: 14, marginBottom: 24, flexWrap: "wrap" }}>
        {[
          { label: "Closed Won",           value: totalClosedWon > 0 ? formatCurrency(totalClosedWon) : "—", color: "#4ade80", sub: `${closedDeals.length} deal${closedDeals.length !== 1 ? "s" : ""}`, border: "#166534" },
          { label: "Pipeline Value",       value: formatCurrency(totalPipeline),   color: "var(--text-body)", sub: `${openDeals.length} open deals` },
          { label: "Confidence-Adjusted",  value: formatCurrency(totalAdjusted),   color: "#a5f3fc", sub: `${totalPipeline > 0 ? Math.round((totalAdjusted / totalPipeline) * 100) : 0}% of pipeline` },
          { label: "This Month",           value: thisMonthAdj > 0 ? formatCurrency(thisMonthAdj) : "—", color: "#818cf8", sub: now.toLocaleDateString("en-US", { month: "long", year: "numeric" }) },
          { label: "Next Month",           value: nextMonthAdj > 0 ? formatCurrency(nextMonthAdj) : "—", color: "#fbbf24", sub: nextMonthDate.toLocaleDateString("en-US", { month: "long", year: "numeric" }) },
        ].map(card => (
          <div key={card.label} style={{ background: "var(--surface)", border: `1px solid ${card.border || "var(--border-strong)"}`, borderRadius: 10, padding: "14px 20px", flex: "1 1 140px", minWidth: 130 }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 7 }}>{card.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: card.color }}>{card.value}</div>
            {card.sub && <div style={{ fontSize: 11, color: "#475569", marginTop: 3 }}>{card.sub}</div>}
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 2, marginBottom: 20, borderBottom: "1px solid #334155", paddingBottom: 0 }}>
        {[
          { id: "dashboards", label: "Dashboards" },
          { id: "deals",      label: "Pipeline Deals" },
          { id: "activity",   label: "Events & Outbound" },
        ].map(tab => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "8px 18px", fontSize: 13, cursor: "pointer",
                background: "none", border: "none", borderBottom: active ? "2px solid #6366f1" : "2px solid transparent",
                color: active ? "#a5b4fc" : "var(--text-muted)", fontWeight: active ? 600 : 400,
                marginBottom: -1, transition: "color 0.15s",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Dashboards tab */}
      {activeTab === "dashboards" && (
        <PipelineDashboards deals={deals} />
      )}

      {/* Deals tab */}
      {activeTab === "deals" && (
        <>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 360 }}>
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#475569", fontSize: 14, pointerEvents: "none" }}>🔍</span>
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search deals by name…"
                style={{
                  width: "100%", boxSizing: "border-box",
                  paddingLeft: 32, paddingRight: searchQuery ? 28 : 10,
                  paddingTop: 7, paddingBottom: 7,
                  background: "var(--surface)", border: "1px solid #334155",
                  borderRadius: 7, color: "var(--text-body)", fontSize: 13,
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}
                >×</button>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {PRODUCT_FILTERS.map(f => {
                const active = productFilter === f.id;
                return (
                  <button
                    key={f.id}
                    onClick={() => setProductFilter(f.id)}
                    style={{
                      padding: "5px 13px", fontSize: 12, borderRadius: 6, cursor: "pointer", fontWeight: active ? 600 : 400,
                      border: active ? `1px solid ${f.color || "#6366f1"}` : "1px solid #334155",
                      background: active ? (f.color ? f.color + "22" : "rgba(99,102,241,0.15)") : "var(--surface)",
                      color: active ? (f.color || "#a5b4fc") : "var(--text-label)",
                    }}
                  >{f.label}</button>
                );
              })}
            </div>
            {(searchQuery || productFilter !== "all") && (
              <span style={{ fontSize: 12, color: "#475569" }}>
                {filteredDeals.length} of {deals.length} deals
              </span>
            )}
          </div>
          {/* Pipeline by Close Month chart */}
          {deals.length > 0 && (() => {
            const monthMap = {};
            deals.forEach(d => {
              const month = d.expectedCloseMonth;
              if (!month) return;
              if (!monthMap[month]) monthMap[month] = { full: 0, adj: 0 };
              const conf = d.useAlgoConfidence
                ? (() => {
                    let s = d.hubspotStageProbability != null ? d.hubspotStageProbability * 100 : 30;
                    if (d.meetingBooked) s += 15;
                    const t = d.touchCount || 0;
                    if (t >= 6) s += 20; else if (t >= 3) s += 10; else if (t >= 1) s += 5;
                    if (d.lastActivityDate) {
                      const days = Math.floor((Date.now() - new Date(d.lastActivityDate)) / 86_400_000);
                      if (days >= 60) s -= 20; else if (days >= 30) s -= 10;
                    }
                    return Math.max(0, Math.min(100, Math.round(s)));
                  })()
                : (d.manualConfidence ?? 50);
              const val = d.value || 0;
              monthMap[month].full += val;
              monthMap[month].adj += val * (conf / 100);
            });
            const sortedMonths = Object.keys(monthMap).sort();
            if (sortedMonths.length === 0) return null;
            const maxFull = Math.max(...sortedMonths.map(k => monthMap[k].full), 1);
            const totalFull = sortedMonths.reduce((s, k) => s + monthMap[k].full, 0);
            const totalAdj = sortedMonths.reduce((s, k) => s + monthMap[k].adj, 0);
            const fmt = n => n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`;
            return (
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: showCloseChart ? 14 : 0 }}>
                  <button
                    onClick={() => setShowCloseChart(v => !v)}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <span style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                      Pipeline by Close Month
                    </span>
                    <span style={{ fontSize: 10, color: "#475569" }}>{showCloseChart ? "▲" : "▼"}</span>
                  </button>
                  {showCloseChart && (
                    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "#818cf8", fontFamily: "'DM Mono',monospace" }}>{fmt(totalFull)} full</span>
                      <span style={{ fontSize: 11, color: "#a5f3fc", fontFamily: "'DM Mono',monospace" }}>{fmt(totalAdj)} adj</span>
                    </div>
                  )}
                </div>
                {showCloseChart && (
                  <>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 88 }}>
                      {sortedMonths.map(key => {
                        const { full, adj } = monthMap[key];
                        const fullH = full > 0 ? Math.max(Math.round((full / maxFull) * 68), 6) : 0;
                        const adjH = adj > 0 ? Math.max(Math.round((adj / maxFull) * 68), 4) : 0;
                        const label = new Date(key + "-02").toLocaleDateString("en-US", { month: "short" });
                        return (
                          <div key={key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                            <span style={{ fontSize: 9, color: "#a5f3fc", fontFamily: "'DM Mono',monospace" }}>{fmt(adj)}</span>
                            <div style={{ width: "100%", flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", position: "relative" }}>
                              {fullH > 0 && <div style={{ width: "100%", height: fullH, borderRadius: "3px 3px 0 0", background: "#334155", position: "absolute", bottom: 0 }} />}
                              {adjH > 0 && <div style={{ width: "100%", height: adjH, borderRadius: "3px 3px 0 0", background: "linear-gradient(180deg,#67e8f9,#06b6d4)", position: "absolute", bottom: 0 }} />}
                            </div>
                            <span style={{ fontSize: 8, color: "var(--text-faint)", fontFamily: "'DM Mono',monospace" }}>{label}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 2, background: "#334155" }} />
                        <span style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "'DM Mono',monospace" }}>Full pipeline</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 2, background: "linear-gradient(180deg,#67e8f9,#06b6d4)" }} />
                        <span style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "'DM Mono',monospace" }}>Adjusted</span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          {/* Pipeline Added by Month chart */}
          {deals.length > 0 && (() => {
            const monthMap = {};
            deals.forEach(d => {
              const ts = d.createdAt;
              if (!ts) return;
              const dt = typeof ts.toDate === "function" ? ts.toDate() : ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
              if (isNaN(dt)) return;
              const month = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
              if (!monthMap[month]) monthMap[month] = { full: 0, adj: 0 };
              const conf = d.useAlgoConfidence
                ? (() => {
                    let s = d.hubspotStageProbability != null ? d.hubspotStageProbability * 100 : 30;
                    if (d.meetingBooked) s += 15;
                    const t = d.touchCount || 0;
                    if (t >= 6) s += 20; else if (t >= 3) s += 10; else if (t >= 1) s += 5;
                    if (d.lastActivityDate) {
                      const days = Math.floor((Date.now() - new Date(d.lastActivityDate)) / 86_400_000);
                      if (days >= 60) s -= 20; else if (days >= 30) s -= 10;
                    }
                    return Math.max(0, Math.min(100, Math.round(s)));
                  })()
                : (d.manualConfidence ?? 50);
              const val = d.value || 0;
              monthMap[month].full += val;
              monthMap[month].adj += val * (conf / 100);
            });
            const sortedMonths = Object.keys(monthMap).sort();
            if (sortedMonths.length === 0) return null;
            const maxFull = Math.max(...sortedMonths.map(k => monthMap[k].full), 1);
            const totalFull = sortedMonths.reduce((s, k) => s + monthMap[k].full, 0);
            const totalAdj = sortedMonths.reduce((s, k) => s + monthMap[k].adj, 0);
            const fmt = n => n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`;
            return (
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px", marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: showAddedChart ? 14 : 0 }}>
                  <button
                    onClick={() => setShowAddedChart(v => !v)}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <span style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                      Pipeline Added by Month
                    </span>
                    <span style={{ fontSize: 10, color: "#475569" }}>{showAddedChart ? "▲" : "▼"}</span>
                  </button>
                  {showAddedChart && (
                    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "#818cf8", fontFamily: "'DM Mono',monospace" }}>{fmt(totalFull)} full</span>
                      <span style={{ fontSize: 11, color: "#a5f3fc", fontFamily: "'DM Mono',monospace" }}>{fmt(totalAdj)} adj</span>
                    </div>
                  )}
                </div>
                {showAddedChart && (
                  <>
                    <div style={{ display: "flex", gap: 0 }}>
                      {/* Y-axis */}
                      <div style={{ width: 40, flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "space-between", height: 84, paddingRight: 6, boxSizing: "border-box" }}>
                        <span style={{ fontSize: 8, color: "#475569", fontFamily: "'DM Mono',monospace", textAlign: "right", lineHeight: 1 }}>{fmt(maxFull)}</span>
                        <span style={{ fontSize: 8, color: "#475569", fontFamily: "'DM Mono',monospace", textAlign: "right", lineHeight: 1 }}>{fmt(Math.round(maxFull / 2))}</span>
                        <span style={{ fontSize: 8, color: "#475569", fontFamily: "'DM Mono',monospace", textAlign: "right", lineHeight: 1 }}>$0</span>
                      </div>
                      {/* Bar area */}
                      <div style={{ flex: 1, height: 84, position: "relative" }}>
                        <div style={{ position: "absolute", top: 0, left: 0, right: 0, borderTop: "1px dashed #1e293b" }} />
                        <div style={{ position: "absolute", top: "50%", left: 0, right: 0, borderTop: "1px dashed #1e293b" }} />
                        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, borderTop: "1px solid #334155" }} />
                        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", gap: 6 }}>
                          {sortedMonths.map(key => {
                            const { full, adj } = monthMap[key];
                            const fullH = full > 0 ? Math.max(Math.round((full / maxFull) * 80), 4) : 0;
                            const adjH = adj > 0 ? Math.max(Math.round((adj / maxFull) * 80), 3) : 0;
                            return (
                              <div key={key} style={{ flex: 1, height: "100%", position: "relative" }}>
                                {fullH > 0 && <div style={{ position: "absolute", bottom: 0, width: "100%", height: fullH, borderRadius: "3px 3px 0 0", background: "#334155" }} />}
                                {adjH > 0 && <div style={{ position: "absolute", bottom: 0, width: "100%", height: adjH, borderRadius: "3px 3px 0 0", background: "linear-gradient(180deg,#a78bfa,#7c3aed)" }} />}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    {/* Month labels */}
                    <div style={{ display: "flex", gap: 6, marginLeft: 40, marginTop: 4 }}>
                      {sortedMonths.map(key => (
                        <div key={key} style={{ flex: 1, textAlign: "center" }}>
                          <span style={{ fontSize: 8, color: "var(--text-faint)", fontFamily: "'DM Mono',monospace" }}>
                            {new Date(key + "-02").toLocaleDateString("en-US", { month: "short" })}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 2, background: "#334155" }} />
                        <span style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "'DM Mono',monospace" }}>Full pipeline</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 2, background: "linear-gradient(180deg,#a78bfa,#7c3aed)" }} />
                        <span style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "'DM Mono',monospace" }}>Adjusted</span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })()}
          <MonthByMonthDeals deals={filteredDeals} onUpdate={updateDeal} onDelete={deleteDeal} events={events} token={hsToken} />
        </>
      )}

      {/* Activity tab */}
      {activeTab === "activity" && (
        <>
          <EventsSection events={events} onAdd={addEvent} onDelete={deleteEvent} />
          <OutboundActuals actuals={actuals} onAdd={addActual} onDelete={deleteActual} />
        </>
      )}

      {/* Add to pipeline modal */}
      {showAddDeal && (
        <AddDealModal
          onAdd={addDeal}
          onClose={() => setShowAddDeal(false)}
          hsDeals={hsDeals}
          hsPipelines={hsPipelines}
        />
      )}
    </div>
  );
}
