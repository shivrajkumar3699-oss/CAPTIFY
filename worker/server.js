  if (!statusBaseUrl) {
    console.error(`[${jobId}] NEXT_APP_URL is not configured`);
    return false;
  }

  const url =
    `${statusBaseUrl.replace(/\/+$/, "")}/api/internal/status`;

  const payload = {
    jobId,
    ...statusUpdate,