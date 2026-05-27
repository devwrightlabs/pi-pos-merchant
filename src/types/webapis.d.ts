/**
 * @fileoverview Type augmentations for non-standard browser APIs used by
 * the Pi POS hardware layer: Web Bluetooth API and Web NFC API.
 *
 * These declarations bridge the gap between the standard `lib.dom.d.ts` and
 * the Chromium-extended APIs available in the Pi Browser webview.
 */

// ---------------------------------------------------------------------------
// Web Bluetooth API
// ---------------------------------------------------------------------------

declare global {
  interface BluetoothDevice extends EventTarget {
    readonly id: string;
    readonly name?: string;
    readonly gatt?: BluetoothRemoteGATTServer;
    /** Non-standard: advertising data containing RSSI, available in some Chromium builds. */
    adData?: BluetoothAdvertisingData;
  }

  interface BluetoothAdvertisingData {
    rssi?: number;
    txPower?: number;
    serviceData?: Map<string, DataView>;
    manufacturerData?: Map<number, DataView>;
  }

  interface BluetoothRemoteGATTServer {
    readonly device: BluetoothDevice;
    readonly connected: boolean;
    connect(): Promise<BluetoothRemoteGATTServer>;
    disconnect(): void;
    getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
    getPrimaryServices(service?: string): Promise<BluetoothRemoteGATTService[]>;
  }

  interface BluetoothRemoteGATTService {
    readonly device: BluetoothDevice;
    readonly uuid: string;
    readonly isPrimary: boolean;
    getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>;
    getCharacteristics(characteristic?: string): Promise<BluetoothRemoteGATTCharacteristic[]>;
  }

  interface BluetoothRemoteGATTCharacteristic extends EventTarget {
    readonly service: BluetoothRemoteGATTService;
    readonly uuid: string;
    readonly value: DataView | null;
    readValue(): Promise<DataView>;
    writeValueWithResponse(value: BufferSource): Promise<void>;
    writeValueWithoutResponse(value: BufferSource): Promise<void>;
    startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    addEventListener(
      type: "characteristicvaluechanged",
      listener: (event: Event) => void,
      useCapture?: boolean
    ): void;
  }

  interface BluetoothRequestDeviceFilter {
    services?: string[];
    name?: string;
    namePrefix?: string;
  }

  interface RequestDeviceOptions {
    filters?: BluetoothRequestDeviceFilter[];
    optionalServices?: string[];
    acceptAllDevices?: boolean;
  }

  interface Bluetooth {
    requestDevice(options: RequestDeviceOptions): Promise<BluetoothDevice>;
    getAvailability(): Promise<boolean>;
  }

  interface Navigator {
    readonly bluetooth: Bluetooth;
  }
}

export {};
