
from max30102 import MAX30102
import hrcalc
import time
import numpy as np


class HeartRateMonitor(object):
    """
    A class that encapsulates the max30102 device and provides
    stable heart rate and SpO2 measurements.
    """

    BUFFER_SIZE = 100
    LOOP_TIME = 0.01
    FINGER_DETECTION_THRESHOLD = 50000

    def __init__(self, stabilization_time=10, min_readings=3, print_raw=False, print_result=False):
        """
        Initialize the HeartRateMonitor.

        Args:
            stabilization_time: Seconds to wait for stable reading
            min_readings: Minimum number of valid readings to average
            print_raw: Whether to print raw IR/Red data
            print_result: Whether to print intermediate results
        """
        self.stabilization_time = stabilization_time
        self.min_readings = min_readings
        self.print_raw = print_raw
        self.print_result = print_result

        if print_raw:
            print('IR, Red')

    def get_measurement(self):
        """
        Get a single stable measurement of heart rate and SpO2.

        This method will:
        1. Initialize the sensor
        2. Wait for stable readings
        3. Collect multiple valid readings
        4. Return the median values or error

        Returns:
            tuple: (hr, spo2) if successful, or raises ValueError with error message
        """
        sensor = MAX30102()

        try:
            ir_data = []
            red_data = []
            valid_measurements = []  # List of (hr, spo2) tuples

            start_time = time.time()

            print(f"Waiting for stable reading (up to {self.stabilization_time}s)...")

            while time.time() - start_time < self.stabilization_time:
                # Check if any data is available
                num_bytes = sensor.get_data_present()

                if num_bytes > 0:
                    # Grab all the data and stash it into arrays
                    while num_bytes > 0:
                        red, ir = sensor.read_fifo()
                        num_bytes -= 1
                        ir_data.append(ir)
                        red_data.append(red)

                        if self.print_raw:
                            print("{0}, {1}".format(ir, red))

                    # Maintain rolling window
                    while len(ir_data) > self.BUFFER_SIZE:
                        ir_data.pop(0)
                        red_data.pop(0)

                    # Once we have enough data, try to calculate
                    if len(ir_data) == self.BUFFER_SIZE:
                        # Check if finger is detected
                        if np.mean(ir_data) < self.FINGER_DETECTION_THRESHOLD:
                            if self.print_result:
                                print("Finger not detected")
                            continue

                        # Calculate heart rate and SpO2
                        bpm, valid_bpm, spo2, valid_spo2 = hrcalc.calc_hr_and_spo2(ir_data, red_data)

                        # Only accept if both are valid
                        if valid_bpm and valid_spo2:
                            valid_measurements.append((bpm, spo2))

                            if self.print_result:
                                print(f"Reading {len(valid_measurements)}: BPM = {bpm:.1f}, SpO2 = {spo2:.1f}")

                            # Check if we have enough readings
                            if len(valid_measurements) >= self.min_readings:
                                # Check stability (within 10% variance for both HR and SpO2)
                                if len(valid_measurements) >= 3:
                                    recent_hr = [m[0] for m in valid_measurements[-3:]]
                                    recent_spo2 = [m[1] for m in valid_measurements[-3:]]

                                    avg_hr = np.mean(recent_hr)
                                    avg_spo2 = np.mean(recent_spo2)

                                    variance_hr = (max(recent_hr) - min(recent_hr)) / avg_hr if avg_hr > 0 else 1
                                    variance_spo2 = (max(recent_spo2) - min(recent_spo2)) / avg_spo2 if avg_spo2 > 0 else 1

                                    if variance_hr < 0.1 and variance_spo2 < 0.1:
                                        if self.print_result:
                                            print("Stable reading achieved!")
                                        break

                time.sleep(self.LOOP_TIME)

            # Shutdown sensor
            sensor.shutdown()

            # Process results
            if len(valid_measurements) >= self.min_readings:
                # Use median to reduce outlier impact
                valid_measurements.sort(key=lambda x: x[0])  # Sort by HR
                median_idx = len(valid_measurements) // 2
                median_hr = valid_measurements[median_idx][0]

                # Sort by SpO2 for median
                valid_measurements.sort(key=lambda x: x[1])
                median_spo2 = valid_measurements[median_idx][1]

                print(f"\n✓ Measurement complete: HR={median_hr:.1f} BPM, SpO2={median_spo2:.1f}%")
                print(f"  Based on {len(valid_measurements)} valid readings")

                return (round(median_hr, 1), round(median_spo2, 1))
            else:
                error_msg = f"Insufficient stable readings (got {len(valid_measurements)}, need {self.min_readings})"
                print(f"\n✗ Measurement failed: {error_msg}")
                raise ValueError(error_msg)

        except Exception as e:
            # Ensure sensor is shut down even on error
            sensor.shutdown()
            raise
