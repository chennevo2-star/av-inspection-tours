import { describe, expect, it } from "vitest";
import { enforceKnownEntityIds, type InspectionExtraction } from "../src/ai-schemas.js";

const KNOWN_FLOOR = "11111111-1111-1111-1111-111111111111";
const KNOWN_ROOM = "22222222-2222-2222-2222-222222222222";
const KNOWN_CONTRACTOR = "33333333-3333-3333-3333-333333333333";
const INVENTED_FLOOR = "99999999-9999-9999-9999-999999999999";
const INVENTED_ROOM = "88888888-8888-8888-8888-888888888888";
const INVENTED_CONTRACTOR = "77777777-7777-7777-7777-777777777777";

const KNOWN_IDS = {
  floorIds: new Set([KNOWN_FLOOR]),
  roomIds: new Set([KNOWN_ROOM]),
  contractorIds: new Set([KNOWN_CONTRACTOR]),
};

function baseExtraction(overrides: Partial<InspectionExtraction["findings"][number]>): InspectionExtraction {
  return {
    inspectionSummary: "סיכום בדיקה",
    findings: [
      {
        floorId: null,
        roomId: null,
        category: null,
        subject: "נושא",
        finding: "ממצא",
        requiredAction: null,
        responsibleContractorId: null,
        secondaryResponsibleContractorId: null,
        priority: null,
        confidence: 0.9,
        needsUserReview: false,
        ...overrides,
      },
    ],
    tasks: [],
    photoAssociations: [],
    contractorMentions: [],
    roomMentions: [],
    previousTaskUpdates: [],
  };
}

describe("enforceKnownEntityIds — the code-level half of 'AI never invents entities' (spec §53)", () => {
  it("passes known ids through unchanged, without forcing review", () => {
    const extraction = baseExtraction({
      floorId: KNOWN_FLOOR,
      roomId: KNOWN_ROOM,
      responsibleContractorId: KNOWN_CONTRACTOR,
    });

    const result = enforceKnownEntityIds(extraction, KNOWN_IDS);

    expect(result.findings[0]).toMatchObject({
      floorId: KNOWN_FLOOR,
      roomId: KNOWN_ROOM,
      responsibleContractorId: KNOWN_CONTRACTOR,
      needsUserReview: false,
    });
  });

  it("nulls an invented floorId and forces needsUserReview, even if the model claimed high confidence", () => {
    const extraction = baseExtraction({ floorId: INVENTED_FLOOR, confidence: 0.95, needsUserReview: false });

    const result = enforceKnownEntityIds(extraction, KNOWN_IDS);

    expect(result.findings[0]?.floorId).toBeNull();
    expect(result.findings[0]?.needsUserReview).toBe(true);
  });

  it("nulls an invented roomId independently of floorId", () => {
    const extraction = baseExtraction({ floorId: KNOWN_FLOOR, roomId: INVENTED_ROOM });

    const result = enforceKnownEntityIds(extraction, KNOWN_IDS);

    expect(result.findings[0]?.floorId).toBe(KNOWN_FLOOR); // untouched — only the bad field is cleared
    expect(result.findings[0]?.roomId).toBeNull();
    expect(result.findings[0]?.needsUserReview).toBe(true);
  });

  it("nulls an invented primary AND secondary contractor id independently", () => {
    const extraction = baseExtraction({
      responsibleContractorId: INVENTED_CONTRACTOR,
      secondaryResponsibleContractorId: KNOWN_CONTRACTOR,
    });

    const result = enforceKnownEntityIds(extraction, KNOWN_IDS);

    expect(result.findings[0]?.responsibleContractorId).toBeNull();
    expect(result.findings[0]?.secondaryResponsibleContractorId).toBe(KNOWN_CONTRACTOR); // the known one survives
    expect(result.findings[0]?.needsUserReview).toBe(true);
  });

  it("a genuinely null id (the model correctly said 'I don't know') stays null without forcing review on its own", () => {
    const extraction = baseExtraction({ floorId: null, roomId: null, responsibleContractorId: null });

    const result = enforceKnownEntityIds(extraction, KNOWN_IDS);

    expect(result.findings[0]?.needsUserReview).toBe(false);
  });

  it("handles multiple findings independently in one extraction", () => {
    const extraction: InspectionExtraction = {
      ...baseExtraction({}),
      findings: [
        { ...baseExtraction({}).findings[0]!, floorId: KNOWN_FLOOR },
        { ...baseExtraction({}).findings[0]!, floorId: INVENTED_FLOOR },
      ],
    };

    const result = enforceKnownEntityIds(extraction, KNOWN_IDS);

    expect(result.findings[0]?.floorId).toBe(KNOWN_FLOOR);
    expect(result.findings[0]?.needsUserReview).toBe(false);
    expect(result.findings[1]?.floorId).toBeNull();
    expect(result.findings[1]?.needsUserReview).toBe(true);
  });

  it("leaves inspectionSummary and every non-finding array untouched", () => {
    const extraction = baseExtraction({ floorId: INVENTED_FLOOR });
    extraction.inspectionSummary = "סיכום מקורי";
    extraction.tasks = [
      { existingTaskId: null, description: "משימה", responsibleParty: null, proposedStatus: null, evidence: "עדות", confidence: 0.5 },
    ];

    const result = enforceKnownEntityIds(extraction, KNOWN_IDS);

    expect(result.inspectionSummary).toBe("סיכום מקורי");
    expect(result.tasks).toEqual(extraction.tasks);
  });
});
