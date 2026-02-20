/**
 * Keypoint Extractor Tests
 * Tests for the enhanced keypoint extraction system
 */

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const { extractKeypoints, KEYPOINT_SCHEMA, KEYPOINT_PROMPT } = require('../../api/generators/keypoint-extractor');

describe('Keypoint Extractor', () => {
  describe('Schema Validation', () => {
    it('should have all required properties in schema', () => {
      expect(KEYPOINT_SCHEMA).toHaveProperty('type', 'object');
      expect(KEYPOINT_SCHEMA).toHaveProperty('properties');
      expect(KEYPOINT_SCHEMA.properties).toHaveProperty('overview');
      expect(KEYPOINT_SCHEMA.properties).toHaveProperty('keypoints');
      expect(KEYPOINT_SCHEMA.properties).toHaveProperty('trails');
      expect(KEYPOINT_SCHEMA).toHaveProperty('required');
      expect(KEYPOINT_SCHEMA.required).toContain('overview');
      expect(KEYPOINT_SCHEMA.required).toContain('keypoints');
      expect(KEYPOINT_SCHEMA.required).toContain('trails');
    });

    it('should define overview schema correctly', () => {
      const overviewSchema = KEYPOINT_SCHEMA.properties.overview;
      expect(overviewSchema.properties).toHaveProperty('mainTopic');
      expect(overviewSchema.properties).toHaveProperty('contentType');
      expect(overviewSchema.properties).toHaveProperty('platform');
      expect(overviewSchema.properties).toHaveProperty('immediateAnswer');
    });

    it('should define keypoint item schema correctly', () => {
      const keypointSchema = KEYPOINT_SCHEMA.properties.keypoints.items;
      expect(keypointSchema.properties).toHaveProperty('id');
      expect(keypointSchema.properties).toHaveProperty('title');
      expect(keypointSchema.properties).toHaveProperty('description');
      expect(keypointSchema.properties).toHaveProperty('trail');
      expect(keypointSchema.properties).toHaveProperty('obviousQuestion');
      expect(keypointSchema.properties).toHaveProperty('quickAnswer');
      expect(keypointSchema.properties).toHaveProperty('bounds');
      expect(keypointSchema.properties).toHaveProperty('needsVerification');
      expect(keypointSchema.properties).toHaveProperty('deepDivePrompts');
    });

    it('should define trail enum values', () => {
      const trailEnum = KEYPOINT_SCHEMA.properties.keypoints.items.properties.trail.enum;
      expect(trailEnum).toContain('people');
      expect(trailEnum).toContain('events');
      expect(trailEnum).toContain('facts');
      expect(trailEnum).toContain('products');
      expect(trailEnum).toContain('context');
      expect(trailEnum).toContain('claims');
      expect(trailEnum).toContain('dates');
      expect(trailEnum).toContain('locations');
      expect(trailEnum).toContain('general');
    });

    it('should define priority enum values', () => {
      const priorityEnum = KEYPOINT_SCHEMA.properties.keypoints.items.properties.priority.enum;
      expect(priorityEnum).toContain('critical');
      expect(priorityEnum).toContain('high');
      expect(priorityEnum).toContain('medium');
      expect(priorityEnum).toContain('low');
    });
  });

  describe('Prompt Content', () => {
    it('should include key instructions in prompt', () => {
      expect(KEYPOINT_PROMPT).toContain('What am I looking at?');
      expect(KEYPOINT_PROMPT).toContain('What are the key things here?');
      expect(KEYPOINT_PROMPT).toContain('Trail Organization');
    });

    it('should mention all trail types in prompt', () => {
      expect(KEYPOINT_PROMPT).toContain('People trail');
      expect(KEYPOINT_PROMPT).toContain('Events trail');
      expect(KEYPOINT_PROMPT).toContain('Facts trail');
      expect(KEYPOINT_PROMPT).toContain('Products trail');
      expect(KEYPOINT_PROMPT).toContain('Context trail');
      expect(KEYPOINT_PROMPT).toContain('Claims trail');
      expect(KEYPOINT_PROMPT).toContain('Dates trail');
      expect(KEYPOINT_PROMPT).toContain('Locations trail');
    });

    it('should include examples for different content types', () => {
      expect(KEYPOINT_PROMPT).toContain('Twitter screenshot');
      expect(KEYPOINT_PROMPT).toContain('Amazon product page');
      expect(KEYPOINT_PROMPT).toContain('news article');
    });

    it('should emphasize visible information only', () => {
      expect(KEYPOINT_PROMPT).toContain('visible in the screenshot');
      expect(KEYPOINT_PROMPT).toContain('Not visible in screenshot');
    });
  });

  describe('Module Exports', () => {
    it('should export extractKeypoints function', () => {
      expect(typeof extractKeypoints).toBe('function');
    });

    it('should export KEYPOINT_SCHEMA', () => {
      expect(KEYPOINT_SCHEMA).toBeDefined();
      expect(typeof KEYPOINT_SCHEMA).toBe('object');
    });

    it('should export KEYPOINT_PROMPT', () => {
      expect(KEYPOINT_PROMPT).toBeDefined();
      expect(typeof KEYPOINT_PROMPT).toBe('string');
      expect(KEYPOINT_PROMPT.length).toBeGreaterThan(100);
    });
  });
});
