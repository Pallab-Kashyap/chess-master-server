import mongoose, { Document, Schema } from "mongoose";
import { GAME_VARIANTS } from "../constants";


interface IUserProfile extends Document {
    userId: string,
    rating: GAME_VARIANTS
}


const UserProfileSchema = new Schema<IUserProfile>({
    userId: {
        type: String,
        required: [true, "User ID is required"]
    },
    rating: {
        rapid: {
            type: Number,
            default: 400
        },
        blitz: {
            type: Number,
            default: 400
        },
        bullet: {
            type: Number,
            default: 400
        }
    },

})

const UserProfileModel = mongoose.model<IUserProfile>('UserProfile', UserProfileSchema)

export default UserProfileModel
