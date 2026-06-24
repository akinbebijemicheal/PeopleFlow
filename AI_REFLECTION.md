# AI Usage Reflection

## 1. Which AI tools did you use, if any?

I used Claude Code Pro (Claude Sonnet 4.6) throughout the project as a development assistant.

## 2. How did you use them?

I used AI to help with scaffolding, generating boilerplate code, suggesting implementations, writing tests, and reviewing approaches to different problems. For each feature, I reviewed the generated code, tested it locally, and made changes where needed before committing anything to the repository.

I also used AI to discuss design decisions and evaluate different implementation options before choosing an approach.

## 3. Which generated code did you modify and why?

One area I modified was the Prisma setup. The initial configuration caused compatibility issues with the project's CommonJS setup, so I adjusted the configuration and ultimately chose Prisma 6 because it provided a more stable setup for this project.

I also modified the implementation of the `reject()` flow after identifying a race condition during concurrent approval and rejection operations. The original version could return an incorrect result if another request changed the status between validation and update. I updated the logic to properly handle that scenario and return the appropriate error response.

I adapted the shared response handling into NestJS-specific patterns using a global exception filter and response interceptor. During this process, I removed XML response support because the API specification only required JSON responses.

I also fixed a small linting issue involving a floating promise in the application bootstrap process.

## 4. What AI suggestions did you reject and why?

One suggestion I chose not to implement was introducing Redis-based locking for concurrency control. After reviewing the problem, I concluded that the existing database transaction and atomic update approach already solved the issue correctly. Adding Redis would have increased complexity without providing meaningful benefits for the current requirements.

I also simplified the commit message format suggested by the AI. The original style was overly detailed for a small project, so I used shorter Conventional Commit messages instead.

## 5. What technical decisions were entirely yours?

Several implementation decisions were made by me:

 Deducting leave balances only during approval rather than at submission time.
 Making approve and reject operations idempotent so retries would not cause duplicate deductions or unexpected failures.
 Using an `X-Tenant-Id` header for tenant separation instead of implementing a full authentication system, which was outside the scope of the assessment.
 Keeping balance deductions synchronous within the approval process instead of introducing queues or asynchronous processing.
 Choosing Prisma 6 over Prisma 7 after encountering compatibility and dependency issues.

## 6. What part of the work would you be most comfortable defending in a technical interview?

I would be most comfortable discussing the concurrency handling around leave request approvals.

The main challenge was preventing multiple concurrent requests from deducting leave balances more than once. I implemented an atomic database update that only succeeds when the request is still in a pending state, ensuring that concurrent operations cannot both approve the same request.

To verify the solution, I added an end-to-end test that sends concurrent approval requests using `Promise.all`. The test confirms that only one approval succeeds and that leave balances are deducted exactly once.

This is the area of the project where I spent the most time thinking about correctness, testing, and failure scenarios, and it is the part I would be most confident explaining in detail during a technical discussion.
