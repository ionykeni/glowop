export function createConfirmationResponse(runtimeBuild, includeValidationMetadata = false) {
  return (body, init) => {
    const validationErrors = body?.validation_errors
      || body?.debug?.series_errors
      || body?.errors
      || (body?.error ? [body.error] : []);
    const validationMetadata = includeValidationMetadata && body?.success === false
      ? { validation_errors: validationErrors, validation_error_count: validationErrors.length }
      : {};
    return Response.json({ ...body, ...validationMetadata, runtime_build: runtimeBuild }, init);
  };
}

export function sleepingDatesOverlap(a1, a2, b1, b2) {
  return a1 < b2 && b1 < a2;
}

export function operationalSleepingMaxPax(tent) {
  return tent.tent_type === 'VIP' || tent.is_accessible === true || /^8\d/.test(String(tent.code || ''))
    ? 4
    : (tent.capacity || 8);
}