import { ProjectService } from './project.service';

describe('ProjectService', () => {
  let service: ProjectService;

  beforeAll(() => {
    delete process.env.POSTGRES_HOST;
  });

  beforeEach(() => {
    service = new ProjectService();
  });

  it('creates tenant, template, project and task flow', async () => {
    const tenant = await service.createTenant({
      name: 'Ngola Telecom',
      slug: 'ngola-telecom',
      ownerUserId: 'user-1',
    });

    const template = await service.createTemplate({
      name: 'Rollout Template',
      tenantId: tenant.id,
      industry: 'telecom',
      phases: [{ name: 'Planning' }, { name: 'Execution' }],
      taskTemplates: [],
      isPublic: true,
    });

    const project = await service.createProject({
      tenantId: tenant.id,
      templateId: template.id,
      name: 'Fiber Rollout',
      createdBy: 'user-1',
      members: [{ userId: 'user-1', role: 'owner' }],
    });

    const label = await service.createLabel({
      tenantId: tenant.id,
      name: 'Critical Path',
    });

    const phase = (await service.getPhases(project.id))[0];
    const task = await service.createTask({
      tenantId: tenant.id,
      projectId: project.id,
      phaseId: phase.id,
      title: 'Survey site',
      createdBy: 'user-1',
      assigneeIds: ['user-2', 'user-3'],
      labelIds: [label.id],
      customFields: { region: 'Luanda' },
    });

    expect(await service.getTenants()).toHaveLength(1);
    expect(await service.getProjects(tenant.id)).toHaveLength(1);
    expect(await service.getPhases(project.id)).toHaveLength(2);
    expect((await service.getTasks(project.id))[0]).toMatchObject({
      id: task.id,
      assigneeIds: ['user-2', 'user-3'],
      labelIds: [label.id],
    });
  });
});
