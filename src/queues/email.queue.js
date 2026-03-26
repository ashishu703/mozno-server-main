import { Queue } from "bullmq";
import redis from "../configs/redis.js";

const emailQueue = new Queue("email-queue", {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 3000,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
    timeout: 30000, // ⏱ prevents stuck jobs
    failParentOnFailure: false,
  },
});

export default emailQueue;
