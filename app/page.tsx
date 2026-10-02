        if (!response.ok) {
          throw new Error("Unable to read job status.");
        }

        const data = (await response.json()) as JobStatus;

        // Status must only move forward. Even if a cached/late response ever
        // arrives, it can never pull the UI back from 100% to 41%.
        if (terminalStatusRef.current) {
          return;
        }

        const renderFinished =
          data.status === "rendering" &&
          Number(data.progress) >= 100 &&
          Array.isArray(data.clips) &&
          data.clips.length > 0;

        if (
          data.status === "done" ||
          data.status === "error" ||
          renderFinished
        ) {
          terminalStatusRef.current = true;
          highestProgressRef.current =
            data.status === "error" ? highestProgressRef.current : 100;

          setStatus(
            renderFinished
              ? {
                  ...data,
                  status: "done",
                  progress: 100,
                  message: data.message || "Clips ready",
                }
              : data
          );

          stopPolling();
          return;
        }

        const incomingProgress = Math.max(
          0,
          Math.min(100, Number(data.progress) || 0)
        );

        highestProgressRef.current = Math.max(
          highestProgressRef.current,
          incomingProgress
        );

        setStatus((current) => ({
          ...(current || data),
          ...data,
          progress: highestProgressRef.current,
        }));
      } catch (err) {
        console.error(err);
      }
    },
    [stopPolling]
  );

  const startPolling = useCallback(
    (id: string) => {
      stopPolling();
