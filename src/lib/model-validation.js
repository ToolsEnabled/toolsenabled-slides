'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Validation receives workspace and asset policy from the owning server.
module.exports = function createModelValidator({DATA, BOX_SHAPE_PRESETS, storedImageSourceError, storedVideoSourceError}) {
  const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);
  function validateModelDocument(value, requireDecorIds = false) {
    if (!isRecord(value)) return 'root must be an object';
    if (typeof value.title !== 'string') return 'title must be a string';
    if (!Number.isInteger(value.rev) || value.rev < 0) return 'rev must be a non-negative integer';
    if (!Array.isArray(value.slides) || value.slides.length === 0) return 'slides must be a non-empty array';
    if (process.env.SLIDES_WORKSPACE && value.slides.length > 200) return 'Deck is limited to 200 slides';
    if (process.env.SLIDES_WORKSPACE && Buffer.byteLength(JSON.stringify(value)) > 2*1024*1024) return 'Deck model is limited to 2 MiB';
    if (value.theme !== undefined && !isRecord(value.theme)) return 'theme must be an object';
    if (value.theme && value.theme.accent !== undefined &&
        (typeof value.theme.accent !== 'string' ||
         !/^#[0-9a-fA-F]{6}$/.test(value.theme.accent))) return 'theme.accent must be a #RRGGBB color';
    if (value.mode !== undefined && !['native', 'overlay'].includes(value.mode)) return 'mode must be native or overlay';
    if (value.mode === 'overlay' && (typeof value.base !== 'string' || !value.base.trim())) {
      return 'an overlay model needs a base PowerPoint path';
    }
    if (process.env.SLIDES_WORKSPACE && value.mode === 'overlay' && (path.dirname(value.base) !== DATA || (fs.existsSync(value.base) && fs.lstatSync(value.base).isSymbolicLink()))) return 'overlay base must be a private imported workspace file';
    if (value.shapePresetSchema !== undefined && value.shapePresetSchema !== 1) {
      return 'shapePresetSchema must be 1 when present';
    }
    const slideIds = new Set();
    const sources = new Set();
    const objectIds = new Set();
    const shapeRefs = new Set();
    const validNativeLayouts = new Set(['title', 'content', 'bullets', 'section', 'titleonly', 'blank', 'two', 'compare']);
    const validateBox = (box, label) => {
      if (!isRecord(box)) return `${label} must be an object`;
      let fields = 0;
      for (const key of ['x', 'y', 'w', 'h']) {
        if (box[key] === undefined) continue;
        fields++;
        const number = box[key];
        if (typeof number !== 'number' || !Number.isFinite(number)) return `${label}.${key} must be finite`;
        if ((key === 'w' || key === 'h') && number <= 0) return `${label}.${key} must be positive`;
      }
      if (!fields) return `${label} must contain geometry`;
      return null;
    };
    const validateGeneratedBox = (box, label) => {
      if (!isRecord(box)) return `${label} must be an object`;
      for (const key of ['x', 'y', 'w', 'h']) {
        const number = box[key];
        if (typeof number !== 'number' || !Number.isFinite(number)) {
          return `${label}.${key} must be a finite number`;
        }
        if (number < 0 || number > 1) return `${label}.${key} must be between 0 and 1`;
        if ((key === 'w' || key === 'h') && number <= 0) return `${label}.${key} must be positive`;
      }
      if (box.x + box.w > 1 || box.y + box.h > 1) return `${label} must fit within the slide`;
      return null;
    };
    const validateStyle = (style, label) => {
      if (!isRecord(style)) return `${label} must be an object`;
      for (const key of ['color', 'fill', 'outline']) {
        if (style[key] !== undefined &&
            (typeof style[key] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(style[key]))) {
          return `${label}.${key} must be a #RRGGBB color`;
        }
      }
      if (style.bold !== undefined && typeof style.bold !== 'boolean') return `${label}.bold must be a boolean`;
      if (style.size !== undefined &&
          (typeof style.size !== 'number' || !Number.isFinite(style.size) || style.size <= 0 || style.size > 400)) {
        return `${label}.size must be greater than 0 and no more than 400`;
      }
      if (style.align !== undefined && !['left', 'center', 'right', 'justify'].includes(style.align)) {
        return `${label}.align is invalid`;
      }
      if (style.font !== undefined &&
          (typeof style.font !== 'string' || !/^[A-Za-z0-9 \-]{1,60}$/.test(style.font))) {
        return `${label}.font is invalid`;
      }
      return null;
    };
    for (let i = 0; i < value.slides.length; i++) {
      const slide = value.slides[i];
      if (!isRecord(slide)) return `slides[${i}] must be an object`;
      if (typeof slide.id !== 'string' || !slide.id) return `slides[${i}].id must be a non-empty string`;
      if (slideIds.has(slide.id)) return `duplicate slide id "${slide.id}"`;
      slideIds.add(slide.id);
      if (typeof slide.layout !== 'string') return `slide "${slide.id}" needs a string layout`;
      if (slide.src === undefined && !validNativeLayouts.has(slide.layout)) {
        return `native slide "${slide.id}" has an unknown layout "${slide.layout}"`;
      }
      if (slide.notes !== undefined && typeof slide.notes !== 'string') return `slide "${slide.id}".notes must be a string`;
      if (slide.transition !== undefined) {
        const transition = slide.transition;
        if (!isRecord(transition)) return `slide "${slide.id}".transition must be an object`;
        const unknownTransitionFields = Object.keys(transition)
          .filter((key) => !['effect', 'duration'].includes(key))
          .sort();
        if (unknownTransitionFields.length) {
          return `slide "${slide.id}".transition has unknown field: ${unknownTransitionFields[0]}`;
        }
        if (!['fade', 'none'].includes(transition.effect)) {
          return `slide "${slide.id}".transition.effect must be fade or none`;
        }
        if (transition.effect === 'fade') {
          if (typeof transition.duration !== 'number' || !Number.isFinite(transition.duration) ||
              transition.duration < 0.1 || transition.duration > 10) {
            return `slide "${slide.id}".transition.duration must be a finite number from 0.1 to 10 seconds`;
          }
        } else if (transition.duration !== undefined) {
          return `slide "${slide.id}".transition.duration is only valid for fade`;
        }
      }
      if (!Array.isArray(slide.elements)) return `slide "${slide.id}" needs an elements array`;
      if (slide.decor !== undefined && !Array.isArray(slide.decor)) return `slide "${slide.id}".decor must be an array`;
      if (slide.animations !== undefined && !Array.isArray(slide.animations)) {
        return `slide "${slide.id}".animations must be an array`;
      }
      if (slide.src !== undefined) {
        if (!Number.isInteger(slide.src) || slide.src < 0) return `slide "${slide.id}".src must be a non-negative integer`;
        if (sources.has(slide.src)) return `duplicate imported slide source ${slide.src}`;
        sources.add(slide.src);
      }
      for (let j = 0; j < slide.elements.length; j++) {
        const element = slide.elements[j];
        if (!isRecord(element)) return `slide "${slide.id}" element ${j} must be an object`;
        if (typeof element.id !== 'string' || !element.id) return `slide "${slide.id}" element ${j} needs an id`;
        if (objectIds.has(element.id)) return `duplicate object id "${element.id}"`;
        objectIds.add(element.id);
        if (typeof element.type !== 'string' || !element.type) return `element "${element.id}" needs a type`;
        if (element.text !== undefined && typeof element.text !== 'string') return `element "${element.id}".text must be a string`;
        if (element.items !== undefined &&
            (!Array.isArray(element.items) || !element.items.every((item) => typeof item === 'string'))) {
          return `element "${element.id}".items must be an array of strings`;
        }
        if (element.style !== undefined) {
          const invalidStyle = validateStyle(element.style, `element "${element.id}".style`);
          if (invalidStyle) return invalidStyle;
        }
        if (element.ref !== undefined) {
          if (!isRecord(element.ref) || !Number.isInteger(element.ref.s) || !Number.isInteger(element.ref.sid)) {
            return `element "${element.id}".ref must contain integer s and sid`;
          }
          if (slide.src !== undefined && element.ref.s !== slide.src) {
            return `element "${element.id}".ref.s must match its slide source`;
          }
          const refKey = `${element.ref.s}:${element.ref.sid}`;
          if (shapeRefs.has(refKey)) return `duplicate backing shape ref ${refKey}`;
          shapeRefs.add(refKey);
        } else if (value.mode === 'overlay' && slide.src !== undefined && !element.readonly) {
          return `imported element "${element.id}" needs a backing shape ref`;
        }
        if (element.sourcePreset !== undefined) {
          if (!BOX_SHAPE_PRESETS.has(element.sourcePreset)) {
            return `element "${element.id}".sourcePreset is not an eligible box/card preset`;
          }
          if (value.mode !== 'overlay' || slide.src === undefined || !element.ref || element.readonly) {
            return `element "${element.id}".sourcePreset is valid only for an editable imported AutoShape`;
          }
        }
        if (element.corners !== undefined) {
          if (element.corners !== 'sharp') return `element "${element.id}".corners must be sharp`;
          if (!BOX_SHAPE_PRESETS.has(element.sourcePreset)) {
            return `element "${element.id}".corners needs eligible imported sourcePreset metadata`;
          }
        }
        if (element.box !== undefined) {
          // Imported shapes may legitimately extend beyond a slide, but a box
          // authored for native text is an explicit normalized placement and
          // must be complete, finite, positive, and fully on-slide.
          const invalidBox = slide.src === undefined
            ? validateGeneratedBox(element.box, `element "${element.id}".box`)
            : validateBox(element.box, `element "${element.id}".box`);
          if (invalidBox) return invalidBox;
        }
      }
      for (let j = 0; j < (slide.decor || []).length; j++) {
        const decor = slide.decor[j];
        if (!isRecord(decor)) return `slide "${slide.id}" decor ${j} must be an object`;
        if (decor.id === undefined && !requireDecorIds) {
          // assignDecorLocalIds() is the boot migration for this legacy shape.
        } else {
          if (typeof decor.id !== 'string' || !decor.id) return `slide "${slide.id}" decor ${j} needs an id`;
          if (objectIds.has(decor.id)) return `duplicate object id "${decor.id}"`;
          objectIds.add(decor.id);
        }
        if (!['shape', 'pic', 'media'].includes(decor.kind)) return `decor "${decor.id}" has an unknown kind`;
        if (decor.sid !== undefined && decor.sid !== null &&
            (!Number.isInteger(decor.sid) || decor.sid < 0)) return `decor "${decor.id}".sid must be a non-negative integer or null`;
        if (decor.generated !== undefined && decor.generated !== true) {
          return `decor "${decor.id}".generated must be true when present`;
        }
        if (decor.sourcePreset !== undefined) {
          if (!BOX_SHAPE_PRESETS.has(decor.sourcePreset)) {
            return `decor "${decor.id}".sourcePreset is not an eligible box/card preset`;
          }
          if (value.mode !== 'overlay' || slide.src === undefined ||
              decor.generated === true || decor.kind !== 'shape' || !Number.isInteger(decor.sid)) {
            return `decor "${decor.id}".sourcePreset is valid only for an imported AutoShape`;
          }
        }
        if (decor.corners !== undefined) {
          if (decor.corners !== 'sharp') return `decor "${decor.id}".corners must be sharp`;
          if (!BOX_SHAPE_PRESETS.has(decor.sourcePreset)) {
            return `decor "${decor.id}".corners needs eligible imported sourcePreset metadata`;
          }
        }
        if (decor.shapeType !== undefined && decor.shapeType !== 'rect') {
          return `decor "${decor.id}" has an unknown shapeType`;
        }
        if (decor.generated === true) {
          const isNativeSlide = slide.src === undefined;
          const isImportedOverlaySlide =
            (value.mode || 'native') === 'overlay' && Number.isInteger(slide.src);
          if (!isNativeSlide && !isImportedOverlaySlide) {
            return `generated decor "${decor.id}" is allowed only on suite-native or imported overlay slides`;
          }
          if (decor.sid !== null) return `generated decor "${decor.id}".sid must be null`;
          const invalidGeneratedBox = validateGeneratedBox(decor.box, `decor "${decor.id}".box`);
          if (invalidGeneratedBox) return invalidGeneratedBox;
          if (decor.kind === 'shape') {
            if (decor.shapeType !== 'rect') return `generated decor "${decor.id}".shapeType must be rect`;
            if (typeof decor.fill !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(decor.fill)) {
              return `generated decor "${decor.id}".fill must be a #RRGGBB color`;
            }
            if (decor.source !== undefined) return `generated shape "${decor.id}" cannot have a source`;
          } else if (decor.kind === 'pic') {
            if (decor.shapeType !== undefined) return `generated picture "${decor.id}" cannot have shapeType`;
            if (decor.fill !== undefined) return `generated picture "${decor.id}" cannot have fill`;
            const invalidSource = storedImageSourceError(decor.source);
            if (invalidSource) return `generated picture "${decor.id}".${invalidSource}`;
          } else if (decor.kind === 'media') {
            if (decor.shapeType !== undefined) return `generated media "${decor.id}" cannot have shapeType`;
            if (decor.fill !== undefined) return `generated media "${decor.id}" cannot have fill`;
            const invalidSource = storedVideoSourceError(decor.source);
            if (invalidSource) return `generated media "${decor.id}".${invalidSource}`;
            if (typeof decor.autoplay !== 'boolean') {
              return `generated media "${decor.id}".autoplay must be a boolean`;
            }
            if (typeof decor.loop !== 'boolean') {
              return `generated media "${decor.id}".loop must be a boolean`;
            }
          } else {
            return `generated decor "${decor.id}" must have kind shape, pic, or media`;
          }
        } else {
          if (decor.kind === 'media') {
            return `decor "${decor.id}" media is valid only for generated decor`;
          }
          if (decor.shapeType !== undefined) {
            return `decor "${decor.id}".shapeType is valid only for generated decor`;
          }
          const invalidBox = validateBox(decor.box, `decor "${decor.id}".box`);
          if (invalidBox) return invalidBox;
        }
        if (decor.fill !== undefined &&
            (typeof decor.fill !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(decor.fill))) {
          return `decor "${decor.id}".fill must be a #RRGGBB color`;
        }
      }
      const localIds = new Set([
        ...slide.elements.map((element) => element.id),
        ...(slide.decor || []).map((decor) => decor.id),
      ]);
      const mediaIds = new Set(
        (slide.decor || [])
          .filter((decor) => decor.kind === 'media')
          .map((decor) => decor.id)
      );
      const animatedIds = new Set();
      for (let j = 0; j < (slide.animations || []).length; j++) {
        const animation = slide.animations[j];
        const label = `slide "${slide.id}" animation ${j}`;
        if (!isRecord(animation)) return `${label} must be an object`;
        const unknown = Object.keys(animation)
          .filter((key) => !['targetId', 'effect', 'trigger', 'duration', 'delay'].includes(key))
          .sort();
        if (unknown.length) return `${label} has unknown field: ${unknown[0]}`;
        if (typeof animation.targetId !== 'string' || !localIds.has(animation.targetId)) {
          return `${label}.targetId must name an element or decor item on the same slide`;
        }
        if (mediaIds.has(animation.targetId)) {
          return `${label}.targetId cannot name a media item`;
        }
        if (animatedIds.has(animation.targetId)) return `${label}.targetId is duplicated`;
        animatedIds.add(animation.targetId);
        if (!['appear', 'fade', 'wipe', 'rise-up'].includes(animation.effect)) {
          return `${label}.effect must be appear, fade, wipe, or rise-up`;
        }
        if (!['click', 'with-previous', 'after-previous'].includes(animation.trigger)) {
          return `${label}.trigger must be click, with-previous, or after-previous`;
        }
        if (j === 0 && animation.trigger !== 'click') {
          return `${label}.trigger must be click for the first animation`;
        }
        if (typeof animation.duration !== 'number' || !Number.isFinite(animation.duration) ||
            animation.duration < 0.1 || animation.duration > 10) {
          return `${label}.duration must be a finite number from 0.1 to 10 seconds`;
        }
        if (typeof animation.delay !== 'number' || !Number.isFinite(animation.delay) ||
            animation.delay < 0 || animation.delay > 30) {
          return `${label}.delay must be a finite number from 0 to 30 seconds`;
        }
      }
    }
    return null;
  }
  return validateModelDocument;
};
