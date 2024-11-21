import * as fs from "node:fs/promises";
import { FitDevInfo, FitWriter } from "./src/fit-encode";

type ParsedJSON = {
  time: Date;
  ele: number;
  dist: number;
  cad: number;
  hr: number;
  lat: number;
  lng: number;
  speed: number;
  power?: number;
  wind?: number;
  cl16?: number;
};

function parseJson(rawJson: string): ParsedJSON[] {
  const parsed = JSON.parse(rawJson) as Array<Record<string, unknown>>;
  if (!Array.isArray(parsed)) {
    throw new Error("Invalid json");
  }
  const get_time = (v: unknown) => {
    if (typeof v !== "string") {
      throw new Error("Expected a string");
    }
    return new Date(v);
  };
  const get_num = (v: unknown) => {
    if (typeof v !== "number") {
      throw new Error("Expected a number");
    }
    return v;
  };
  return parsed.map((e) => {
    return {
      time: get_time(e.time),
      ele: get_num(e.ele),
      dist: get_num(e.dist),
      cad: get_num(e.cad),
      hr: get_num(e.hr),
      lat: get_num(e.lat),
      lng: get_num(e.lng),
      speed: get_num(e.speed),
      power: e.power == null ? undefined : get_num(e.power),
      wind: e.wind == null ? undefined : get_num(e.wind),
      cl16: get_num(e.cl16),
    } as const;
  });
}

function makeFit(parsed: ParsedJSON[], repeatCount: number = 1) {
  const fitWriter = new FitWriter();

  const totalTimeSpan = +parsed[parsed.length - 1].time - +parsed[0].time;

  const elapsed_time = (start: number, end: number) => {
    return ((+parsed[end - 1].time - +parsed[start].time) * repeatCount) / 1000;
  };

  const summary = (start: number, end: number) => {
    const startSample = parsed[start];
    const endSample = parsed[end] ?? parsed[end - 1];
    return {
      timestamp: fitWriter.time(startSample.time),
      start_time: fitWriter.time(startSample.time),
      total_elapsed_time: elapsed_time(start, end),
      total_timer_time: elapsed_time(start, end),
      total_distance: (endSample.dist - startSample.dist) * repeatCount,
      start_position_lat: fitWriter.latlng(startSample.lat),
      start_position_long: fitWriter.latlng(startSample.lng),
      sport: "cycling",
    } as const;
  };

  const start = fitWriter.time(parsed[0].time);
  fitWriter.writeMessage(
    "file_id",
    {
      type: "activity",
      manufacturer: "garmin",
      product: 0,
      serial_number: 0xdeadbeef,
      time_created: start,
      product_name: "AeroPod",
    },
    null,
    true
  );

  fitWriter.writeMessage(
    "developer_data_id",
    {
      application_id: "42c9182e-23a6-425f-b8fc-316d3d164a6f"
        .replace(/-/g, "")
        .match(/../g)!
        .map((s) => parseInt(s, 16)),
      developer_data_index: 0,
    },
    null,
    true
  );

  const windFieldNum = 0;
  fitWriter.writeMessage(
    "field_description",
    {
      developer_data_index: 0,
      field_definition_number: windFieldNum,
      field_name: "Wind",
      fit_base_type_id: 137, // float64
      units: "m/s",
    },
    null,
    true
  );

  fitWriter.writeMessage(
    "activity",
    {
      total_timer_time: elapsed_time(0, parsed.length),
      num_sessions: 1,
      type: "manual",
      timestamp: start,
      local_timestamp: start - parsed[0].time.getTimezoneOffset() * 60,
    },
    null,
    true
  );
  fitWriter.writeMessage("session", summary(0, parsed.length), null, true);
  const laps = [
    0,
    parsed.length >> 2,
    parsed.length >> 1,
    (parsed.length * 3) >> 2,
  ];
  laps.forEach((start, i) => {
    const end = laps[i + 1] ?? parsed.length;
    fitWriter.writeMessage(
      "lap",
      summary(start, end),
      null,
      i === laps.length - 1
    );
  });
  // Write records for each repeat
  for (let repeat = 0; repeat < repeatCount; repeat++) {
    const timeOffset = repeat * totalTimeSpan;
    const isForward = repeat % 2 === 0;

    const records = isForward ? parsed : [...parsed].reverse();
    records.forEach((v) => {
      const timestamp = fitWriter.time(new Date(+v.time + timeOffset));
      const distance = v.dist * repeatCount * (repeat + 1);

      fitWriter.writeMessage(
        "record",
        {
          power: v.power,
          timestamp,
          speed: v.speed,
          distance,
          altitude: v.ele,
          cadence: v.cad,
          heart_rate: v.hr,
          position_lat: fitWriter.latlng(v.lat),
          position_long: fitWriter.latlng(v.lng),
          cycle_length16: v.cl16,
        },
        v.wind != null ? [{ field_num: windFieldNum, value: v.wind }] : null
      );
    });
  }

  return fitWriter.finish();
}

async function processJson(jsonFileName: string) {
  const rawJson = await fs.readFile(jsonFileName, "utf-8");
  const json = parseJson(rawJson);
  const rawFit = makeFit(json, 100);
  const name = "./examples/big-file.fit";
  await fs.writeFile(name, Buffer.from(rawFit.buffer));
}

processJson("./examples/test1.json").then((data) => {
  console.log(data);
});
