"""
Heart Rate Monitor IoT Device - Main Application
ECE 513 Project - Heart Track Application

This module implements a synchronous state machine for the IoT device that:
1. Periodically reminds users to take measurements (blue LED flash)
2. Takes accurate heart rate and SpO2 measurements
3. Transmits data to server when WiFi available (green LED)
4. Stores data locally when offline (yellow LED, up to 24 hours)
5. Supports configurable measurement schedule and frequency
"""

from heartrate_monitor import HeartRateMonitor
import time
import json
import os
from datetime import datetime, timedelta
from enum import Enum
import argparse
import threading
from typing import Any
import sys
import tomllib
import sqlite3

# GPIO imports for LED control
try:
    from gpiozero import LED
    GPIO_AVAILABLE = True
except ImportError:
    GPIO_AVAILABLE = False
    print("Warning: gpiozero not available. LED control disabled.")

# AWS IoT imports
from awsiot import mqtt5_client_builder
from awscrt import mqtt5, io


class DeviceState(Enum):
    """State machine states for the IoT device"""
    IDLE = 1                    # Waiting for next measurement time
    REMINDER = 2                # Flashing blue LED to remind user
    MEASURING = 3               # Taking measurement from sensor
    TRANSMITTING = 4            # Sending data to server
    STORING_LOCALLY = 5         # Storing data locally when offline


class HeartTrackDevice:
    """
    Main IoT device controller implementing synchronous state machine.
    Manages sensor readings, data transmission, and local storage.
    """
    
    # GPIO pin assignments for LEDs (BCM numbering)
    LED_YELLOW_PIN = 17   # GPIO 17 - Yellow LED (offline/storing locally)
    LED_BLUE_PIN = 27     # GPIO 27 - Blue LED (reminder)
    LED_GREEN_PIN = 22    # GPIO 22 - Green LED (online/transmitted)

    def __init__(self, config_file: str = "device_config.toml"):
        """
        Initialize the Heart Track IoT device.
        
        Args:
            config_file: Path to TOML configuration file
        """
        self.state = DeviceState.IDLE
        self.config_file = config_file
        
        # Load configuration from TOML
        self.config = self.load_config()
        
        # Extract storage file from config and convert to .db
        self.storage_file = self.config["storage"]["file"]
        
        # Initialize SQLite database
        self._init_database()
        
        # Initialize LED objects
        self.led_yellow = None
        self.led_blue = None
        self.led_green = None
        self._init_gpio()
        
        # Initialize sensor with config parameters
        self.sensor = HeartRateMonitor(
            stabilization_time=self.config["measurement"]["stabilization_time"],
            min_readings=self.config["measurement"]["min_readings"],
            print_raw=False,
            print_result=True
        )

        # Timing variables
        self.last_measurement_time = None
        self.next_measurement_time = self.calculate_next_measurement_time()
        self.reminder_start_time = None
        
        # Connection status
        self.wifi_connected = False
        self.mqtt_client = None
        self.connection_success = threading.Event()
        
        # Measurement data
        self.current_measurement: dict[str, Any] = {}
        
        # Initialize AWS IoT connection
        self.setup_mqtt_connection()
        
        print(f"Device initialized. Next measurement at: {self.next_measurement_time}")
    
    def _init_database(self):
        """Initialize SQLite database with required table."""
        try:
            conn = sqlite3.connect(self.storage_file)
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS measurements (
                    timestamp TEXT PRIMARY KEY,
                    device_id TEXT,
                    heart_rate REAL,
                    spo2 INTEGER,
                    valid INTEGER,
                    api_key TEXT,
                    reading_count INTEGER
                )
            ''')
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"Error initializing database: {e}")
            sys.exit(1)
    
    def _init_gpio(self):
        """Initialize LED objects using gpiozero."""
        if not GPIO_AVAILABLE:
            return
        
        try:
            # Initialize LED objects (gpiozero uses BCM numbering by default)
            self.led_yellow = LED(self.LED_YELLOW_PIN)
            self.led_blue = LED(self.LED_BLUE_PIN)
            self.led_green = LED(self.LED_GREEN_PIN)
            
            # Ensure all LEDs are off initially
            self.led_yellow.off()
            self.led_blue.off()
            self.led_green.off()
            
            print("GPIO initialized for LED control using gpiozero")
        except Exception as e:
            print(f"Error initializing GPIO: {e}")
    
    def load_config(self):
        """Load device configuration from TOML file."""
        if not os.path.exists(self.config_file):
            print(f"Error: Configuration file '{self.config_file}' not found.")
            sys.exit(1)
        
        try:
            with open(self.config_file, 'rb') as f:
                config = tomllib.load(f)
            
            # Validate required sections and fields
            required_sections = {
                "measurement": ["start_hour", "end_hour", "interval_seconds", "stabilization_time", "min_readings"],
                "device": ["id", "reminder_timeout_seconds"],
                "storage": ["max_hours", "file"],
                "mqtt": ["endpoint", "client_id", "topic"],  # config_topic is optional
                "security": ["cert_path", "key_path", "api_key"]
            }
            
            for section, fields in required_sections.items():
                if section not in config:
                    print(f"Error: Missing required section '{section}' in config file.")
                    sys.exit(1)
                for field in fields:
                    if field not in config[section]:
                        print(f"Error: Missing required field '{field}' in section '{section}'.")
                        sys.exit(1)
            
            print(f"Configuration loaded from {self.config_file}")
            return config
            
        except Exception as e:
            print(f"Error loading config: {e}")
            sys.exit(1)
    
    def calculate_next_measurement_time(self):
        """Calculate the next scheduled measurement time."""
        now = datetime.now()
        start_hour = int(self.config["measurement"]["start_hour"])
        end_hour = int(self.config["measurement"]["end_hour"])
        interval_seconds = int(self.config["measurement"]["interval_seconds"])

        # Calculate next measurement time
        current_seconds = now.hour * 3600 + now.minute * 60 + now.second
        start_seconds = start_hour * 3600
        end_seconds = end_hour * 3600
        
        if current_seconds < start_seconds:
            # Before measurement window - schedule for start time
            next_time = now.replace(hour=start_hour, minute=0, second=0, microsecond=0)
        elif current_seconds >= end_seconds:
            # After measurement window - schedule for tomorrow's start time
            next_time = (now + timedelta(days=1)).replace(hour=start_hour, minute=0, second=0, microsecond=0)
        else:
            # Within measurement window - calculate next interval
            seconds_since_start = current_seconds - start_seconds
            intervals_passed = seconds_since_start // interval_seconds
            next_interval_seconds = start_seconds + (intervals_passed + 1) * interval_seconds
            
            if next_interval_seconds >= end_seconds:
                # Next interval would be outside window - schedule for tomorrow
                next_time = (now + timedelta(days=1)).replace(hour=start_hour, minute=0, second=0, microsecond=0)
            else:
                # Schedule for next interval
                next_hour = next_interval_seconds // 3600
                next_minute = (next_interval_seconds % 3600) // 60
                next_second = next_interval_seconds % 60
                next_time = now.replace(hour=next_hour, minute=next_minute, second=next_second, microsecond=0)
                
                # If calculated time is in the past, add interval
                if next_time <= now:
                    next_time += timedelta(seconds=interval_seconds)
        
        return next_time
    
    def setup_mqtt_connection(self):
        """Setup MQTT connection to AWS IoT."""   
        try:
            cert_path = self.config["security"]["cert_path"]
            key_path = self.config["security"]["key_path"]
            
            # Check if certificate files exist
            if not os.path.exists(cert_path) or not os.path.exists(key_path):
                print(f"Warning: Certificate files not found. Running in offline mode.")
                return
            
            # Create event loop and client bootstrap
            event_loop_group = io.EventLoopGroup(1)
            host_resolver = io.DefaultHostResolver(event_loop_group)
            client_bootstrap = io.ClientBootstrap(event_loop_group, host_resolver)
            
            # Build MQTT5 client
            self.mqtt_client = mqtt5_client_builder.mtls_from_path(
                endpoint=self.config["mqtt"]["endpoint"],
                cert_filepath=cert_path,
                pri_key_filepath=key_path,
                client_bootstrap=client_bootstrap,
                on_lifecycle_attempting_connect=self.on_lifecycle_attempting_connect,
                on_lifecycle_connection_success=self.on_lifecycle_connection_success,
                on_lifecycle_connection_failure=self.on_lifecycle_connection_failure,
                on_lifecycle_disconnection=self.on_lifecycle_disconnection,
                on_publish_received=self.on_publish_received,
                client_id=self.config["mqtt"]["client_id"]
            )
            
            print("MQTT client configured successfully")
            
            # Start connection
            self.mqtt_client.start()
            print("Connecting to AWS IoT...")
            
            # Wait for connection (with timeout)
            if self.connection_success.wait(timeout=10):
                self.wifi_connected = True
                print("Connected to AWS IoT successfully")
            else:
                print("Connection timeout. Running in offline mode.")
                self.wifi_connected = False
                
        except Exception as e:
            print(f"Error setting up MQTT connection: {e}")
            self.wifi_connected = False

    def on_lifecycle_attempting_connect(self, lifecycle_attempting_connect_data: Any):
        """MQTT lifecycle callback: attempting to connect."""
        print("Attempting to connect to AWS IoT...")
    
    def on_lifecycle_connection_success(self, lifecycle_connect_success_data: Any):
        """MQTT lifecycle callback: connection successful."""
        print("Connection to AWS IoT successful")
        self.wifi_connected = True
        self.connection_success.set()
        
        # Subscribe to configuration topic
        config_topic = self.config["mqtt"].get("config_topic", "ece513/config")
        try:
            subscribe_future = self.mqtt_client.subscribe(
                mqtt5.SubscribePacket(
                    subscriptions=[
                        mqtt5.Subscription(
                            topic_filter=config_topic,
                            qos=mqtt5.QoS.AT_LEAST_ONCE
                        )
                    ]
                )
            )
            subscribe_future.result(timeout=5)
            print(f"✓ Subscribed to configuration topic: {config_topic}")
        except Exception as e:
            print(f"⚠ Failed to subscribe to config topic: {e}")

        # Try to send any locally stored data
        self.transmit_stored_data()
    
    def on_publish_received(self, publish_received_data: Any):
        """
        MQTT callback: handle incoming configuration messages.

        Expected JSON format:
        {
            "interval_seconds": 900,  // Optional: new measurement interval
            "start_hour": 6,          // Optional: new start hour
            "end_hour": 22            // Optional: new end hour
        }
        """
        try:
            publish_packet = publish_received_data.publish_packet
            payload = publish_packet.payload.decode('utf-8')
            topic = publish_packet.topic

            print(f"\n📩 Received message on topic: {topic}")
            print(f"Payload: {payload}")

            # Parse JSON configuration
            config_update = json.loads(payload)

            # Update measurement interval if provided
            if "interval_seconds" in config_update:
                new_interval = int(config_update["interval_seconds"])
                if 60 <= new_interval <= 86400:  # Between 1 min and 24 hours
                    old_interval = self.config["measurement"]["interval_seconds"]
                    self.config["measurement"]["interval_seconds"] = new_interval
                    print(f"✓ Updated interval: {old_interval}s → {new_interval}s")
                    # Recalculate next measurement time
                    self.next_measurement_time = self.calculate_next_measurement_time()
                    print(f"  Next measurement: {self.next_measurement_time}")
                else:
                    print(f"⚠ Invalid interval: {new_interval}s (must be 60-86400)")

            # Update start hour if provided
            if "start_hour" in config_update:
                new_start = int(config_update["start_hour"])
                if 0 <= new_start <= 23:
                    old_start = self.config["measurement"]["start_hour"]
                    self.config["measurement"]["start_hour"] = new_start
                    print(f"✓ Updated start hour: {old_start} → {new_start}")
                    self.next_measurement_time = self.calculate_next_measurement_time()
                else:
                    print(f"⚠ Invalid start_hour: {new_start} (must be 0-23)")

            # Update end hour if provided
            if "end_hour" in config_update:
                new_end = int(config_update["end_hour"])
                if 0 <= new_end <= 23:
                    old_end = self.config["measurement"]["end_hour"]
                    self.config["measurement"]["end_hour"] = new_end
                    print(f"✓ Updated end hour: {old_end} → {new_end}")
                    self.next_measurement_time = self.calculate_next_measurement_time()
                else:
                    print(f"⚠ Invalid end_hour: {new_end} (must be 0-23)")

        except json.JSONDecodeError as e:
            print(f"⚠ Invalid JSON in config message: {e}")
        except Exception as e:
            print(f"⚠ Error processing config message: {e}")

    def on_lifecycle_connection_failure(self, lifecycle_connection_failure: Any):
        """MQTT lifecycle callback: connection failed."""
        print(f"Connection failed: {lifecycle_connection_failure.exception}")
        self.wifi_connected = False
    
    def on_lifecycle_disconnection(self, lifecycle_disconnect_data: Any):
        """MQTT lifecycle callback: disconnected."""
        print("Disconnected from AWS IoT")
        self.wifi_connected = False

    def flash_led(self, color: str, duration: float = 1.0, flash_count: int = -1):
        """
        Flash LED in specified color.
        
        Args:
            color: LED color ('blue', 'green', 'yellow')
            duration: Total duration to flash (seconds)
            flash_count: Number of flashes (-1 for continuous during duration)
        """
        if not GPIO_AVAILABLE:
            # Fallback to print if GPIO not available
            print(f"[LED] Flashing {color} LED", end="")
            if flash_count > 0:
                print(f" {flash_count} times")
            else:
                print(f" for {duration}s")
            time.sleep(duration)
            return
        
        # Map color to LED object
        led_map = {
            'blue': self.led_blue,
            'green': self.led_green,
            'yellow': self.led_yellow
        }
        
        if color not in led_map or led_map[color] is None:
            print(f"Unknown or uninitialized LED color: {color}")
            return
        
        led = led_map[color]
        
        try:
            if flash_count > 0:
                # Flash specific number of times using gpiozero's blink method
                # on_time and off_time in seconds
                led.blink(on_time=0.2, off_time=0.2, n=flash_count, background=False)
            else:
                # Flash continuously for duration
                start_time = time.time()
                while time.time() - start_time < duration:
                    led.blink(on_time=0.5, off_time=0.5, n=1, background=False)
            
            # Ensure LED is off at the end
            led.off()
            
        except Exception as e:
            print(f"Error controlling LED: {e}")

    def _user_ready(self) -> bool:
        """Determine if the user has started measurement (placeholder hook)."""
        # By default auto-start after a reminder cycle; set env AUTO_START_MEASUREMENT=0 to disable.
        return os.environ.get("AUTO_START_MEASUREMENT", "1") != "0"
    
    def take_measurement(self) -> dict[str, Any]:
        """
        Take heart rate and SpO2 measurement with accuracy optimization.
        
        Returns:
            dict: Measurement data with hr, spo2, timestamp, and validity
        """
        print("\n=== Taking Measurement ===")
        print("Please place your finger on the sensor...")
        
        try:
            # Get measurement from sensor (blocks until complete or timeout)
            hr, spo2 = self.sensor.get_measurement()

            # Create successful measurement data
            measurement_data = {
                "api_key": self.config["security"]["api_key"],
                "device_id": self.config["device"]["id"],
                "heart_rate": hr,
                "spo2": spo2,
                "timestamp": datetime.now().isoformat(),
                "valid": True
            }
            
            print(f"\n✓ Measurement complete: HR={hr} BPM, SpO2={spo2}%")

        except ValueError as e:
            # Measurement failed - return invalid measurement with error
            measurement_data = {
                "api_key": self.config["security"]["api_key"],
                "device_id": self.config["device"]["id"],
                "heart_rate": 0,
                "spo2": 0,
                "timestamp": datetime.now().isoformat(),
                "valid": False,
                "error": str(e)
            }
            print(f"\n✗ Measurement failed: {e}")

        except Exception as e:
            # Unexpected error
            measurement_data = {
                "api_key": self.config["security"]["api_key"],
                "device_id": self.config["device"]["id"],
                "heart_rate": 0,
                "spo2": 0,
                "timestamp": datetime.now().isoformat(),
                "valid": False,
                "error": f"Unexpected error: {str(e)}"
            }
            print(f"\n✗ Unexpected error during measurement: {e}")

        return measurement_data
    
    def transmit_data(self, measurement: dict[str, Any]) -> bool:
        """
        Transmit measurement data to server via MQTT.
        
        Args:
            measurement: Measurement data dictionary
            
        Returns:
            bool: True if transmission successful
        """
        if not self.wifi_connected or not self.mqtt_client:
            print("Cannot transmit: Not connected to server")
            return False
        
        try:
            # Publish to MQTT topic
            message_json = json.dumps(measurement)
            topic = self.config["mqtt"]["topic"]
            publish_future = self.mqtt_client.publish(
                mqtt5.PublishPacket(
                    topic=topic,
                    payload=message_json,
                    qos=mqtt5.QoS.AT_LEAST_ONCE
                )
            )
            
            # Wait for publish to complete (with timeout)
            publish_future.result(timeout=5)
            
            print(f"✓ Data transmitted successfully to {topic}")
            return True
            
        except Exception as e:
            print(f"✗ Transmission failed: {e}")
            return False
    
    def store_locally(self, measurement: dict[str, Any]):
        """
        Store measurement data locally using SQLite.
        Data is immediately written to avoid loss on interruption.
        
        Args:
            measurement: Measurement data dictionary
        """
        try:
            conn = sqlite3.connect(self.storage_file, isolation_level=None)  # Auto-commit
            cursor = conn.cursor()
            
            # Insert measurement
            cursor.execute('''
                INSERT OR REPLACE INTO measurements 
                (timestamp, device_id, heart_rate, spo2, valid, api_key, reading_count)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (
                measurement['timestamp'],
                measurement['device_id'],
                measurement['heart_rate'],
                measurement['spo2'],
                1 if measurement['valid'] else 0,
                measurement['api_key'],
                measurement.get('reading_count', 0)
            ))
            
            # Get total count
            cursor.execute('SELECT COUNT(*) FROM measurements')
            count = cursor.fetchone()[0]
            
            conn.close()
            print(f"✓ Data stored locally ({count} measurements in storage)")
            
        except Exception as e:
            print(f"✗ Local storage failed: {e}")
    
    def cleanup_old_local_data(self):
        """
        Remove measurements older than configured hours from local storage.
        Called periodically to maintain storage limits.
        """
        try:
            if not os.path.exists(self.storage_file):
                return
            
            conn = sqlite3.connect(self.storage_file, isolation_level=None)
            cursor = conn.cursor()
            
            # Get count before cleanup
            cursor.execute('SELECT COUNT(*) FROM measurements')
            original_count = cursor.fetchone()[0]
            
            # Remove measurements older than configured hours
            max_hours = self.config["storage"]["max_hours"]
            cursor.execute('''
                DELETE FROM measurements 
                WHERE datetime(timestamp) < datetime('now', ? || ' hours')
            ''', (f'-{max_hours}',))
            
            # Get count after cleanup
            cursor.execute('SELECT COUNT(*) FROM measurements')
            new_count = cursor.fetchone()[0]
            
            conn.close()
            
            if original_count > new_count:
                print(f"✓ Cleaned up {original_count - new_count} old measurements")
            
        except Exception as e:
            print(f"Error cleaning up old data: {e}")
    
    def transmit_stored_data(self):
        """Legacy method - no longer transmits stored data."""
        pass
    
    def run_state_machine(self):
        """
        Main state machine loop.
        Implements synchronous state transitions.
        """
        print("\n=== Starting Heart Track Device ===")
        print(f"Measurement schedule: {self.config['measurement']['start_hour']}:00 - {self.config['measurement']['end_hour']}:00")
        print(f"Measurement interval: Every {self.config['measurement']['interval_seconds']} seconds")
        print(f"Next measurement: {self.next_measurement_time}")
        
        try:
            while True:
                # State: IDLE
                if self.state == DeviceState.IDLE:
                    now = datetime.now()
                    
                    # Check if it's time for next measurement
                    if now >= self.next_measurement_time:
                        print(f"\n[{now.strftime('%H:%M:%S')}] Time for measurement!")
                        self.state = DeviceState.REMINDER
                        self.reminder_start_time = now
                    else:
                        # Wait a bit before checking again
                        time.sleep(1)
                        continue
                
                # State: REMINDER
                elif self.state == DeviceState.REMINDER:
                    timeout = self.config["device"]["reminder_timeout_seconds"]
                    while True:
                        now = datetime.now()
                        elapsed = (now - self.reminder_start_time).total_seconds()
                        remaining = max(int(timeout - elapsed), 0)
                        
                        # Flash blue LED repeatedly until user responds or timeout
                        print(f"[REMINDER] Please take measurement (timeout in {remaining}s)")
                        self.flash_led('blue', duration=1)
                        
                        if elapsed >= timeout:
                            print("⚠ Measurement timeout - skipping this measurement")
                            self.next_measurement_time = self.calculate_next_measurement_time()
                            self.state = DeviceState.IDLE
                            break
                        
                        if self._user_ready():
                            print("→ User ready, proceeding to measurement")
                            self.state = DeviceState.MEASURING
                            break
                        
                        # Keep flashing until ready or timeout
                        time.sleep(1)
                
                # State: MEASURING
                elif self.state == DeviceState.MEASURING:
                    self.current_measurement: dict[str, Any] = self.take_measurement()
                    self.last_measurement_time = datetime.now()
                    
                    if self.current_measurement["valid"]:
                        # Save measurement locally first
                        self.store_locally(self.current_measurement)
                        self.state = DeviceState.TRANSMITTING
                    else:
                        print("Measurement invalid, returning to idle")
                        self.next_measurement_time = self.calculate_next_measurement_time()
                        self.state = DeviceState.IDLE
                
                # State: TRANSMITTING
                elif self.state == DeviceState.TRANSMITTING:
                    if self.wifi_connected and self.transmit_data(self.current_measurement):
                        # Success - data remains in local storage for 24h, flash green LED
                        print("✓ Transmission successful (data kept in local storage for 24h)")
                        self.flash_led('green', duration=0.5, flash_count=1)
                    else:
                        # Failed - data already stored locally, flash yellow LED
                        print("✗ Transmission failed - data stored locally")
                        self.flash_led('yellow', duration=0.5, flash_count=1)
                    
                    # Periodically clean up old data (>24 hours)
                    self.cleanup_old_local_data()
                    
                    # Return to idle and calculate next measurement time
                    self.next_measurement_time = self.calculate_next_measurement_time()
                    print(f"\nNext measurement scheduled for: {self.next_measurement_time}")
                    self.state = DeviceState.IDLE
                
        except KeyboardInterrupt:
            print("\n\nShutting down device...")
            self.cleanup()
    
    def cleanup(self):
        """Clean up resources before exit."""
        if self.mqtt_client:
            print("Disconnecting from AWS IoT...")
            self.mqtt_client.stop()
        
        # Clean up GPIO
        if GPIO_AVAILABLE:
            print("Cleaning up GPIO...")
            if self.led_yellow:
                self.led_yellow.close()
            if self.led_blue:
                self.led_blue.close()
            if self.led_green:
                self.led_green.close()
        
        print("Device stopped successfully")


def main():
    """Main entry point for the application."""
    parser = argparse.ArgumentParser(
        description="Heart Track IoT Device - ECE 413/513 Project"
    )
    parser.add_argument(
        "--config", 
        type=str, 
        default="device_config.toml",
        help="Path to TOML device configuration file"
    )
    parser.add_argument(
        "--test-mode",
        action="store_true",
        help="Run in test mode with shorter intervals"
    )
    parser.add_argument(
        "--offline-mode",
        action="store_true",
        help="Force offline mode to test local storage and yellow LED (disables MQTT)"
    )

    args = parser.parse_args()
    
    # Create and run device
    device = HeartTrackDevice(
        config_file=args.config
    )
    
    # Override config for offline mode
    if args.offline_mode:
        print("\n*** RUNNING IN OFFLINE MODE ***")
        print("MQTT connection disabled - all data will be stored locally")
        print("Yellow LED will flash after measurements")
        # Force offline by disconnecting MQTT and setting wifi_connected to False
        if device.mqtt_client:
            device.mqtt_client.stop()
            device.mqtt_client = None
        device.wifi_connected = False

    # Override config for test mode
    if args.test_mode:
        print("\n*** RUNNING IN TEST MODE ***")
        device.config["measurement"]["interval_seconds"] = 15  # 15 second intervals for testing
        device.next_measurement_time = datetime.now() + timedelta(seconds=10)
        print("Measurement interval set to 15 seconds")
        print(f"First measurement in 10 seconds")
    
    # Combined mode message
    if args.test_mode and args.offline_mode:
        print("\n*** COMBINED: TEST + OFFLINE MODE ***")
        print("Short intervals + Offline storage + Yellow LED")

    # Run the state machine
    device.run_state_machine()


if __name__ == '__main__':
    main()
