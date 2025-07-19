import Redis from "ioredis";


const redis = new Redis({
  host: "redis",
  port: 6379,
  retryStrategy: (times) => {
    if (times > 5) return null;
    return Math.min(times * 100, 2000);
  },
});


export function connectRedis() {
  return new Promise((resolve, reject) => {
    if (redis.status === "ready") {
      console.log("🚀 Redis is ready");
      return resolve(1);
    }

    redis.once("ready", () => {
      console.log("🚀 Redis is ready");
      resolve(1);
    });

    redis.once("error", (err) => {
      console.error("❌ Failed to connect to Redis:", err);
      reject(err);
    });
  });
}

export default redis
