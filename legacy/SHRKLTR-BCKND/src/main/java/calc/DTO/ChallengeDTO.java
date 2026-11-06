package calc.DTO;

import java.util.Date;
import java.util.List;

/**
 * Created by clementperez on 01/06/18.
 */
public class ChallengeDTO {

    private Date date;
    private UserDTO challenger;
    private UserDTO challengee;
    private String message;

    public Date getDate() {
        return date;
    }

    public void setDate(Date date) {
        this.date = date;
    }

    public UserDTO getChallenger() {
        return challenger;
    }

    public void setChallenger(UserDTO challenger) {
        this.challenger = challenger;
    }

    public UserDTO getChallengee() {
        return challengee;
    }

    public void setChallengee(UserDTO challengee) {
        this.challengee = challengee;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }
}
