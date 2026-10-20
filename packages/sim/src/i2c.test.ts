import { expect, it } from "vitest"
import { Mpu6050 } from "./i2c"
it("supports repeated-start register reads, configured ranges and injected physical IMU values", () => {
  const imu = new Mpu6050()
  imu.start(false); imu.write(0x75); imu.start(true); expect(imu.read()).toBe(0x68)
  imu.start(false); imu.write(0x6b); imu.write(0); imu.stop()
  imu.setMotion([0, 0, 9.80665], [0, 0, Math.PI / 2])
  imu.start(false); imu.write(0x3f); imu.start(true); expect((imu.read() << 8) | imu.read()).toBe(16384)
  imu.start(false); imu.write(0x47); imu.start(true); expect((imu.read() << 8) | imu.read()).toBe(11790)
})
