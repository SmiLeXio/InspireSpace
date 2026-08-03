import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectCreationComposer } from "./ProjectCreationComposer";

describe("ProjectCreationComposer", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("使用默认名称创建项目", async () => {
    const onCreate = vi.fn(async () => true);
    const view = render(<ProjectCreationComposer browserMode onClose={vi.fn()} onCreate={onCreate} />);
    const ui = within(view.container);

    fireEvent.click(ui.getByRole("button", { name: "创建项目" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("我的灵感空间"));
  });

  it("创建失败时保留输入并显示反馈", async () => {
    const onCreate = vi.fn(async () => false);
    const view = render(<ProjectCreationComposer browserMode={false} onClose={vi.fn()} onCreate={onCreate} />);
    const ui = within(view.container);

    fireEvent.change(ui.getByLabelText("项目名称"), { target: { value: "品牌灵感库" } });
    fireEvent.click(ui.getByRole("button", { name: "创建项目" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("品牌灵感库"));
    expect(await ui.findByRole("alert")).toHaveTextContent("项目未能创建");
    expect(ui.getByLabelText("项目名称")).toHaveValue("品牌灵感库");
  });
});
