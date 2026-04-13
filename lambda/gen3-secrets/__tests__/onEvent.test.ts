import { handler } from "../onEvent";

describe("gen3-secrets onEvent", () => {
  test("dry run creates expected secrets without AWS calls", async () => {
    const event = {
      RequestType: "Create",
      ResourceProperties: {
        project: "proj",
        envName: "dev",
        services: ["metadata"],
        dbHostOverride: "db.example",
        dbPortOverride: 5432,
        passwordLength: 16,
        dryRun: true,
        create: { metadataG3auto: true },
        g3auto: { hostname: "example.org" },
      },
    };

    const res: any = await handler(event);
    const created = JSON.parse(res.Data.created);

    expect(created).toContain("proj-dev-metadata");
    expect(created).toContain("proj-dev-metadata-g3auto");
    expect(created).toContain("proj-dev-indexd-service");
  });

  test("invalid passwordLength does not throw in dry run", async () => {
    const event = {
      RequestType: "Create",
      ResourceProperties: {
        project: "proj",
        envName: "dev",
        services: ["metadata"],
        dbHostOverride: "db.example",
        dbPortOverride: 5432,
        passwordLength: "not-a-number",
        dryRun: true,
        create: {},
      },
    };

    await expect(handler(event)).resolves.toBeTruthy();
  });

  test("missing masterSecretName throws when db overrides are absent", async () => {
    const event = {
      RequestType: "Create",
      ResourceProperties: {
        project: "proj",
        envName: "dev",
        services: [],
        dryRun: true,
        create: {},
      },
    };

    await expect(handler(event)).rejects.toThrow(/Missing masterSecretName/);
  });
});
