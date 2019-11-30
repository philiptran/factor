import { getModel, savePost } from "@factor/post/server"
import { randomToken, addFilter, addCallback, currentUrl } from "@factor/tools"
import { sendTransactional } from "@factor/email/server"
import { HookNextFunction, Schema, Document, SchemaDefinition } from "mongoose"
import { FactorUser } from "./types"
import { EndpointMeta } from "@factor/endpoint/types"
import { SendVerifyEmail, VerifyEmail, VerifyAndResetPassword } from "./email-request"

addCallback("endpoints", { id: "user-emails", handler: "@factor/user/email-endpoint" })

addFilter("user-schema-hooks", (s: Schema) => {
  // EMAIL
  s.post("save", async function(
    this: FactorUser & Document,
    doc,
    next: HookNextFunction
  ): Promise<void> {
    if (!this.isModified("email")) return next()

    const { email, _id } = this
    this.emailVerified = false
    await sendVerifyEmail({ _id, email }, { bearer: this })

    return
  })
})

addFilter(
  "user-schema",
  (_: SchemaDefinition): SchemaDefinition => {
    _.emailVerificationCode = { type: String, select: false }
    _.passwordResetCode = { type: String, select: false }

    return _
  }
)

interface UserEmailConfig {
  to: string;
  subject: string;
  text: string;
  linkText: string;
  action: string;
  _id: string;
  code: string;
}

export async function verifyEmail(
  { _id, code }: VerifyEmail,
  { bearer }: EndpointMeta
): Promise<void> {
  if (!bearer || bearer._id != _id) {
    throw new Error(`Email verification user doesn't match the logged in account.`)
  }

  const user = await getModel("user").findOne({ _id }, "+emailVerificationCode")

  if (user.emailVerificationCode == code) {
    user.emailVerified = true
    user.emailVerificationCode = undefined
    await user.save()
    return
  } else if (!user.emailVerified) {
    throw new Error("Verification code does not match.")
  }
}

export async function sendVerifyEmail(
  { email, _id }: SendVerifyEmail,
  { bearer }: EndpointMeta
): Promise<void> {
  const emailVerificationCode = randomToken()

  await savePost({ data: { _id, emailVerificationCode, postType: "user" } }, { bearer })

  await sendEmail({
    to: email,
    subject: "Confirm Your Email",
    text: "Hello! Please confirm your email by clicking on the following link:",
    linkText: "Verify Email",
    action: "verify-email",
    _id,
    code: emailVerificationCode
  })

  return
}

export async function verifyAndResetPassword({
  _id,
  code,
  password
}: VerifyAndResetPassword): Promise<void> {
  const user = await getModel("post").findOne({ _id }, "+passwordResetCode")

  if (!user) {
    throw new Error(`Could not find user.`)
  }

  if (user.passwordResetCode && user.passwordResetCode == code) {
    user.password = password
    user.passwordResetCode = undefined
    await user.save()
    return
  } else {
    throw new Error("Could not reset your password.")
  }
}

export async function sendPasswordResetEmail({
  email
}: {
  email: string;
}): Promise<void> {
  const passwordResetCode = randomToken()

  const user = await getModel("user").findOneAndUpdate({ email }, { passwordResetCode })

  if (!user || !user._id) {
    throw new Error("Could not find an user with that email.")
  }

  await sendEmail({
    to: email,
    subject: "Password Reset",
    text:
      "Hello! We've received a request to reset the password associated with this account. To do so, just follow this link:",
    linkText: "Reset Password",
    action: "reset-password",
    _id: user._id,
    code: passwordResetCode
  })

  return
}

export async function sendEmail(args: UserEmailConfig): Promise<void> {
  const { to, subject, action, _id, code, text, linkText } = args
  const linkUrl = `${currentUrl()}?_action=${action}&code=${code}&_id=${_id}`

  await sendTransactional({
    to,
    subject,
    text,
    linkText,
    linkUrl
  })

  return
}
