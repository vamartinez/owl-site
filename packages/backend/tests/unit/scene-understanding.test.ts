/**
 * Unit tests for the Scene Understanding Layer service.
 * Tests scene classification prompt construction, response parsing,
 * normalization logic, construction object detection, and edge cases.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */

import { describe, it, expect } from 'vitest';
import {
  buildSceneClassificationPrompt,
  buildClassificationUserMessage,
  hasConstructionObjects,
  parseBedrockSceneResponse,
  normalizeClassification,
} from '../../src/services/scene-understanding/classifier.js';
import {
  SCENE_CONFIDENCE_THRESHOLD,
  SCENE_OLLAMA_MODEL_CONFIG,
  VALID_SCENE_TYPES,
  MAX_SCENE_DESCRIPTION_LENGTH,
  SceneInterpretationStatus,
} from '../../src/services/scene-understanding/types.js';
import { SceneType } from '../../src/shared/types/common.js';

// --- Helper: create a detection object ---

function makeDetection(type: string, confidence = 0.8) {
  return {
    type,
    confidence,
    boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
  };
}

// --- Prompt Construction Tests (Requirement 7.2) ---

describe('scene-understanding: buildSceneClassificationPrompt', () => {
  it('includes all defined scene types', () => {
    const prompt = buildSceneClassificationPrompt();
    for (const sceneType of VALID_SCENE_TYPES) {
      expect(prompt).toContain(sceneType);
    }
  });

  it('includes work_at_height, roofing, excavation, framing, ladder_access, material_handling_near_equipment', () => {
    const prompt = buildSceneClassificationPrompt();
    expect(prompt).toContain('work_at_height');
    expect(prompt).toContain('roofing');
    expect(prompt).toContain('excavation');
    expect(prompt).toContain('framing');
    expect(prompt).toContain('ladder_access');
    expect(prompt).toContain('material_handling_near_equipment');
  });

  it('requests scene_description, activity_label, risk_context, confidence in response', () => {
    const prompt = buildSceneClassificationPrompt();
    expect(prompt).toContain('scene_description');
    expect(prompt).toContain('activity_label');
    expect(prompt).toContain('risk_context');
    expect(prompt).toContain('confidence');
  });

  it('specifies max 200 characters for scene_description', () => {
    const prompt = buildSceneClassificationPrompt();
    expect(prompt).toContain('200 characters');
  });

  it('specifies confidence range 0.0 to 1.0', () => {
    const prompt = buildSceneClassificationPrompt();
    expect(prompt).toContain('0.0');
    expect(prompt).toContain('1.0');
  });

  it('requests primary_hazard and exposed_personnel_count in risk_context', () => {
    const prompt = buildSceneClassificationPrompt();
    expect(prompt).toContain('primary_hazard');
    expect(prompt).toContain('exposed_personnel_count');
  });

  it('requests JSON response format', () => {
    const prompt = buildSceneClassificationPrompt();
    expect(prompt).toContain('JSON');
  });

  it('includes instructions for no construction objects case', () => {
    const prompt = buildSceneClassificationPrompt();
    expect(prompt).toContain('No construction activity detected');
  });
});

// --- User Message Construction Tests ---

describe('scene-understanding: buildClassificationUserMessage', () => {
  it('returns empty detection message when no detections provided', () => {
    const message = buildClassificationUserMessage([]);
    expect(message).toContain('No objects were detected');
  });

  it('includes detection type and confidence in message', () => {
    const detections = [makeDetection('helmet', 0.95)];
    const message = buildClassificationUserMessage(detections);
    expect(message).toContain('helmet');
    expect(message).toContain('0.95');
  });

  it('includes bounding box coordinates in message', () => {
    const detections = [makeDetection('vest', 0.8)];
    const message = buildClassificationUserMessage(detections);
    expect(message).toContain('x=');
    expect(message).toContain('y=');
    expect(message).toContain('w=');
    expect(message).toContain('h=');
  });

  it('numbers multiple detections', () => {
    const detections = [
      makeDetection('helmet', 0.9),
      makeDetection('vest', 0.85),
      makeDetection('ladder', 0.7),
    ];
    const message = buildClassificationUserMessage(detections);
    expect(message).toContain('1.');
    expect(message).toContain('2.');
    expect(message).toContain('3.');
  });

  it('includes instruction to classify the scene', () => {
    const detections = [makeDetection('scaffold', 0.75)];
    const message = buildClassificationUserMessage(detections);
    expect(message).toContain('classify');
  });
});

// --- Construction Object Detection Tests (Requirement 7.6) ---

describe('scene-understanding: hasConstructionObjects', () => {
  it('returns true when helmet is detected', () => {
    expect(hasConstructionObjects([makeDetection('helmet')])).toBe(true);
  });

  it('returns true when vest is detected', () => {
    expect(hasConstructionObjects([makeDetection('vest')])).toBe(true);
  });

  it('returns true when harness is detected', () => {
    expect(hasConstructionObjects([makeDetection('harness')])).toBe(true);
  });

  it('returns true when ladder is detected', () => {
    expect(hasConstructionObjects([makeDetection('ladder')])).toBe(true);
  });

  it('returns true when scaffold is detected', () => {
    expect(hasConstructionObjects([makeDetection('scaffold')])).toBe(true);
  });

  it('returns true when trench_excavation_edge is detected', () => {
    expect(hasConstructionObjects([makeDetection('trench_excavation_edge')])).toBe(true);
  });

  it('returns true when roof_edge is detected', () => {
    expect(hasConstructionObjects([makeDetection('roof_edge')])).toBe(true);
  });

  it('returns true when machinery_proximity is detected', () => {
    expect(hasConstructionObjects([makeDetection('machinery_proximity')])).toBe(true);
  });

  it('returns true when blocked_exit_clutter is detected', () => {
    expect(hasConstructionObjects([makeDetection('blocked_exit_clutter')])).toBe(true);
  });

  it('returns false for empty detections array', () => {
    expect(hasConstructionObjects([])).toBe(false);
  });

  it('returns false when only non-construction objects are detected', () => {
    expect(hasConstructionObjects([makeDetection('tree'), makeDetection('car')])).toBe(false);
  });

  it('returns true when at least one construction object is among non-construction objects', () => {
    const detections = [
      makeDetection('tree'),
      makeDetection('helmet'),
      makeDetection('car'),
    ];
    expect(hasConstructionObjects(detections)).toBe(true);
  });
});

// --- Response Parsing Tests ---

describe('scene-understanding: parseBedrockSceneResponse', () => {
  it('parses valid JSON response', () => {
    const response = JSON.stringify({
      scene_type: 'work_at_height',
      scene_description: 'Workers on scaffold',
      activity_label: 'work_at_height',
      risk_context: { primary_hazard: 'Fall from height', exposed_personnel_count: 2 },
      confidence: 0.85,
      has_construction_objects: true,
    });

    const result = parseBedrockSceneResponse(response);
    expect(result.scene_type).toBe('work_at_height');
    expect(result.confidence).toBe(0.85);
    expect(result.has_construction_objects).toBe(true);
  });

  it('parses JSON wrapped in markdown code block', () => {
    const response = '```json\n{"scene_type": "roofing", "scene_description": "Roofing work", "activity_label": "roofing", "risk_context": {"primary_hazard": "Fall", "exposed_personnel_count": 1}, "confidence": 0.9, "has_construction_objects": true}\n```';

    const result = parseBedrockSceneResponse(response);
    expect(result.scene_type).toBe('roofing');
    expect(result.confidence).toBe(0.9);
  });

  it('parses JSON wrapped in plain code block', () => {
    const response = '```\n{"scene_type": "excavation", "scene_description": "Trench work", "activity_label": "excavation", "risk_context": {"primary_hazard": "Cave-in", "exposed_personnel_count": 3}, "confidence": 0.75, "has_construction_objects": true}\n```';

    const result = parseBedrockSceneResponse(response);
    expect(result.scene_type).toBe('excavation');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseBedrockSceneResponse('not json at all')).toThrow();
  });

  it('throws on missing scene_type', () => {
    const response = JSON.stringify({
      scene_description: 'Workers on scaffold',
      confidence: 0.85,
    });
    expect(() => parseBedrockSceneResponse(response)).toThrow('missing or invalid scene_type');
  });

  it('throws on non-string scene_type', () => {
    const response = JSON.stringify({
      scene_type: 123,
      confidence: 0.85,
    });
    expect(() => parseBedrockSceneResponse(response)).toThrow('missing or invalid scene_type');
  });

  it('throws on missing confidence', () => {
    const response = JSON.stringify({
      scene_type: 'work_at_height',
      scene_description: 'Workers on scaffold',
    });
    expect(() => parseBedrockSceneResponse(response)).toThrow('missing or invalid confidence');
  });

  it('throws on non-number confidence', () => {
    const response = JSON.stringify({
      scene_type: 'work_at_height',
      confidence: 'high',
    });
    expect(() => parseBedrockSceneResponse(response)).toThrow('missing or invalid confidence');
  });

  it('parses response with null risk_context', () => {
    const response = JSON.stringify({
      scene_type: 'unclassified',
      scene_description: 'No construction activity detected',
      activity_label: 'none',
      risk_context: null,
      confidence: 0.0,
      has_construction_objects: false,
    });

    const result = parseBedrockSceneResponse(response);
    expect(result.risk_context).toBeNull();
    expect(result.has_construction_objects).toBe(false);
  });
});

// --- Normalization Tests (Requirements 7.3, 7.5, 7.6) ---

describe('scene-understanding: normalizeClassification', () => {
  const validResponse = {
    scene_type: 'work_at_height',
    scene_description: 'Two workers on scaffold platform without visible harness',
    activity_label: 'work_at_height',
    risk_context: { primary_hazard: 'Fall from height', exposed_personnel_count: 2 },
    confidence: 0.85,
    has_construction_objects: true,
  };

  const constructionDetections = [makeDetection('helmet'), makeDetection('scaffold')];
  const nonConstructionDetections = [makeDetection('tree'), makeDetection('car')];

  // --- Requirement 7.6: No construction objects ---

  it('returns "No construction activity detected" when no construction objects in detections', () => {
    const result = normalizeClassification(validResponse, nonConstructionDetections);
    expect(result.scene_type).toBe(SceneType.UNCLASSIFIED);
    expect(result.scene_description).toBe('No construction activity detected');
    expect(result.risk_context).toBeNull();
    expect(result.confidence).toBe(0.0);
  });

  it('returns "No construction activity detected" when model says has_construction_objects is false', () => {
    const response = { ...validResponse, has_construction_objects: false };
    const result = normalizeClassification(response, constructionDetections);
    expect(result.scene_type).toBe(SceneType.UNCLASSIFIED);
    expect(result.scene_description).toBe('No construction activity detected');
    expect(result.risk_context).toBeNull();
  });

  it('returns "No construction activity detected" for empty detections array', () => {
    const result = normalizeClassification(validResponse, []);
    expect(result.scene_type).toBe(SceneType.UNCLASSIFIED);
    expect(result.scene_description).toBe('No construction activity detected');
  });

  // --- Requirement 7.5: Low confidence → unclassified with best candidate ---

  it('labels "unclassified" when confidence < 0.5 with best candidate', () => {
    const lowConfResponse = { ...validResponse, confidence: 0.4 };
    const result = normalizeClassification(lowConfResponse, constructionDetections);
    expect(result.scene_type).toBe(SceneType.UNCLASSIFIED);
    expect(result.activity_label).toBe('unclassified');
    expect(result.best_candidate).toBeDefined();
    expect(result.best_candidate!.scene_type).toBe(SceneType.WORK_AT_HEIGHT);
    expect(result.best_candidate!.confidence).toBe(0.4);
  });

  it('labels "unclassified" when confidence is exactly 0.49', () => {
    const response = { ...validResponse, confidence: 0.49 };
    const result = normalizeClassification(response, constructionDetections);
    expect(result.scene_type).toBe(SceneType.UNCLASSIFIED);
    expect(result.best_candidate).toBeDefined();
  });

  it('does NOT label "unclassified" when confidence is exactly 0.5', () => {
    const response = { ...validResponse, confidence: 0.5 };
    const result = normalizeClassification(response, constructionDetections);
    expect(result.scene_type).toBe(SceneType.WORK_AT_HEIGHT);
    expect(result.best_candidate).toBeUndefined();
  });

  it('preserves risk_context in unclassified low-confidence result', () => {
    const lowConfResponse = { ...validResponse, confidence: 0.3 };
    const result = normalizeClassification(lowConfResponse, constructionDetections);
    expect(result.risk_context).not.toBeNull();
    expect(result.risk_context!.primary_hazard).toBe('Fall from height');
    expect(result.risk_context!.exposed_personnel_count).toBe(2);
  });

  // --- Requirement 7.3: Valid classification output ---

  it('produces valid classification for high-confidence work_at_height', () => {
    const result = normalizeClassification(validResponse, constructionDetections);
    expect(result.scene_type).toBe(SceneType.WORK_AT_HEIGHT);
    expect(result.scene_description).toBe('Two workers on scaffold platform without visible harness');
    expect(result.activity_label).toBe('work_at_height');
    expect(result.confidence).toBe(0.85);
    expect(result.risk_context).toEqual({
      primary_hazard: 'Fall from height',
      exposed_personnel_count: 2,
    });
  });

  it('produces valid classification for roofing scene', () => {
    const response = {
      ...validResponse,
      scene_type: 'roofing',
      scene_description: 'Workers on roof surface',
      activity_label: 'roofing',
      confidence: 0.92,
    };
    const result = normalizeClassification(response, constructionDetections);
    expect(result.scene_type).toBe(SceneType.ROOFING);
    expect(result.activity_label).toBe('roofing');
  });

  it('produces valid classification for excavation scene', () => {
    const response = {
      ...validResponse,
      scene_type: 'excavation',
      activity_label: 'excavation',
      confidence: 0.78,
    };
    const result = normalizeClassification(response, [makeDetection('trench_excavation_edge')]);
    expect(result.scene_type).toBe(SceneType.EXCAVATION);
  });

  it('produces valid classification for framing scene', () => {
    const response = {
      ...validResponse,
      scene_type: 'framing',
      activity_label: 'framing',
      confidence: 0.7,
    };
    const result = normalizeClassification(response, constructionDetections);
    expect(result.scene_type).toBe(SceneType.FRAMING);
  });

  it('produces valid classification for ladder_access scene', () => {
    const response = {
      ...validResponse,
      scene_type: 'ladder_access',
      activity_label: 'ladder_access',
      confidence: 0.88,
    };
    const result = normalizeClassification(response, [makeDetection('ladder')]);
    expect(result.scene_type).toBe(SceneType.LADDER_ACCESS);
  });

  it('produces valid classification for material_handling_near_equipment scene', () => {
    const response = {
      ...validResponse,
      scene_type: 'material_handling_near_equipment',
      activity_label: 'material_handling_near_equipment',
      confidence: 0.65,
    };
    const result = normalizeClassification(response, [makeDetection('machinery_proximity')]);
    expect(result.scene_type).toBe(SceneType.MATERIAL_HANDLING_NEAR_EQUIPMENT);
  });

  // --- Scene description truncation ---

  it('truncates scene_description to 200 characters', () => {
    const longDescription = 'A'.repeat(300);
    const response = { ...validResponse, scene_description: longDescription };
    const result = normalizeClassification(response, constructionDetections);
    expect(result.scene_description.length).toBe(MAX_SCENE_DESCRIPTION_LENGTH);
  });

  it('preserves scene_description when under 200 characters', () => {
    const shortDescription = 'Workers on scaffold';
    const response = { ...validResponse, scene_description: shortDescription };
    const result = normalizeClassification(response, constructionDetections);
    expect(result.scene_description).toBe(shortDescription);
  });

  // --- Confidence clamping ---

  it('clamps confidence above 1.0 to 1.0', () => {
    const response = { ...validResponse, confidence: 1.5 };
    const result = normalizeClassification(response, constructionDetections);
    expect(result.confidence).toBe(1.0);
  });

  it('clamps negative confidence to 0.0 and marks unclassified', () => {
    const response = { ...validResponse, confidence: -0.5 };
    const result = normalizeClassification(response, constructionDetections);
    expect(result.confidence).toBe(0.0);
    expect(result.scene_type).toBe(SceneType.UNCLASSIFIED);
  });

  // --- Invalid scene type handling ---

  it('treats invalid scene_type as unclassified when confidence >= 0.5', () => {
    const response = { ...validResponse, scene_type: 'invalid_type', confidence: 0.8 };
    const result = normalizeClassification(response, constructionDetections);
    expect(result.scene_type).toBe(SceneType.UNCLASSIFIED);
  });

  it('uses fallback best_candidate when scene_type is invalid and confidence < 0.5', () => {
    const response = { ...validResponse, scene_type: 'invalid_type', confidence: 0.3 };
    const result = normalizeClassification(response, constructionDetections);
    expect(result.scene_type).toBe(SceneType.UNCLASSIFIED);
    expect(result.best_candidate).toBeDefined();
    expect(result.best_candidate!.scene_type).toBe(SceneType.WORK_AT_HEIGHT);
  });

  // --- Risk context handling ---

  it('handles null risk_context from model response', () => {
    const response = { ...validResponse, risk_context: null, confidence: 0.7 };
    const result = normalizeClassification(response, constructionDetections);
    expect(result.risk_context).toBeNull();
  });

  it('rounds exposed_personnel_count to nearest integer', () => {
    const response = {
      ...validResponse,
      risk_context: { primary_hazard: 'Fall', exposed_personnel_count: 2.7 },
    };
    const result = normalizeClassification(response, constructionDetections);
    expect(result.risk_context!.exposed_personnel_count).toBe(3);
  });

  it('clamps negative exposed_personnel_count to 0', () => {
    const response = {
      ...validResponse,
      risk_context: { primary_hazard: 'Fall', exposed_personnel_count: -1 },
    };
    const result = normalizeClassification(response, constructionDetections);
    expect(result.risk_context!.exposed_personnel_count).toBe(0);
  });

  // --- Activity label fallback ---

  it('uses scene_type as activity_label when model omits activity_label', () => {
    const response = { ...validResponse, activity_label: undefined as unknown as string };
    const result = normalizeClassification(response, constructionDetections);
    expect(result.activity_label).toBe('work_at_height');
  });
});

// --- Constants Verification ---

describe('scene-understanding: constants', () => {
  it('SCENE_CONFIDENCE_THRESHOLD is 0.5', () => {
    expect(SCENE_CONFIDENCE_THRESHOLD).toBe(0.5);
  });

  it('SCENE_OLLAMA_MODEL_CONFIG has correct model ID', () => {
    expect(SCENE_OLLAMA_MODEL_CONFIG.modelId).toBe('gpt-oss:120b-cloud');
  });

  it('SCENE_OLLAMA_MODEL_CONFIG has maxTokens 4096', () => {
    expect(SCENE_OLLAMA_MODEL_CONFIG.maxTokens).toBe(4096);
  });

  it('SCENE_OLLAMA_MODEL_CONFIG has temperature 0.1', () => {
    expect(SCENE_OLLAMA_MODEL_CONFIG.temperature).toBe(0.1);
  });

  it('VALID_SCENE_TYPES has 6 scene types', () => {
    expect(VALID_SCENE_TYPES).toHaveLength(6);
  });

  it('MAX_SCENE_DESCRIPTION_LENGTH is 200', () => {
    expect(MAX_SCENE_DESCRIPTION_LENGTH).toBe(200);
  });

  it('SceneInterpretationStatus has completed and failed', () => {
    expect(SceneInterpretationStatus.COMPLETED).toBe('completed');
    expect(SceneInterpretationStatus.FAILED).toBe('failed');
  });
});
