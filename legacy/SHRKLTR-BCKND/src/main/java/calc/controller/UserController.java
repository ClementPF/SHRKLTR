package calc.controller;

import calc.DTO.*;

import java.util.*;
import java.util.stream.Collectors;

import calc.entity.Tournament;
import calc.entity.User;
import calc.exception.APIException;
import calc.security.Secured;
import calc.service.*;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@Secured
public class UserController {

    @Autowired
    private UserService userService;
    @Autowired
    private TournamentService tournamentService;
    @Autowired
    private StatsService statsService;
    @Autowired
    private RivalryStatsService rivalryStatsService;
    @Autowired
    private GameService gameService;
    
    @Resource
    private HttpServletRequest request;

    @RequestMapping(value = "/users", method = RequestMethod.GET)
    public List<UserDTO> users() {

        return userService.findAll();
    }

    @RequestMapping(value = "/user/push", method = RequestMethod.POST)
    public ResponseEntity registerForPushNotification(@RequestBody PushTokenDTO token) {

        return userService.registerForPushNotification(token);
    }

    @RequestMapping(value = "/user/{userName}", method = RequestMethod.GET)
    public UserDTO getUser(@PathVariable(value="userName") String username) {
        return userService.findByUserName(username);
    }

    @RequestMapping(value = "/user", method = RequestMethod.GET)
    public UserDTO getCurrentUser() {
        ProviderUserInfoDTO userInfo = (ProviderUserInfoDTO)request.getAttribute("user_info");
        return userService.findByExternalId(userInfo.getId());
    }

    @RequestMapping(value = "/user", method = RequestMethod.PUT)
    public UserDTO updateUser(@RequestBody UserDTO user) {
        return userService.update(user);
    }

    @RequestMapping(value = "/user/{userName}/stats", method = RequestMethod.GET)
    public List<StatsDTO> userStats(@PathVariable(value="userName") String username) {
        return statsService.findByUserName(username);
    }

    @RequestMapping(value = "/user/{userName}/rivalry", method = RequestMethod.GET)
    public List<RivalryStatsDTO> userRivalryStats(@PathVariable(value="userName") String username,  @RequestParam(value="tournamentName", defaultValue="") String tournamentName) {
        if(tournamentName == null) {
            return rivalryStatsService.findByUsername(username);
        }else{
            return rivalryStatsService.findByUserNameAndTournament(username, tournamentName);
        }
    }

    @RequestMapping(value = "/user/{userName}/tournaments", method = RequestMethod.GET)
    public List<TournamentDTO> userTournaments(@PathVariable(value="userName") String username) {
        return tournamentService.findByUserName(username);
    }

    @RequestMapping(value = "/user/{userName}/challenge", method = RequestMethod.POST)
    public ResponseEntity challengeUser(@PathVariable(value="userName") String username, @RequestBody ChallengeDTO challenge) {

        if(challenge == null || challenge.getChallenger() == null || challenge.getChallengee() == null){
            throw new APIException(UserService.class,"The challenge is invalid",HttpStatus.BAD_REQUEST);
        }

        UserDTO challenger = userService.findByUserName(challenge.getChallenger().getUsername());
        UserDTO challengee = userService.findByUserName(username);

        if(challenger == null ||  challengee == null){
            throw new APIException(UserService.class,"One of the participant doesn't exist",HttpStatus.BAD_REQUEST);
        }

        UserDTO loggedInUser = userService.whoIsLoggedIn();

        if(challenger.getUserId() != loggedInUser.getUserId()){
            throw new APIException(Tournament.class, "Only the logged in user can challenge. Logged in : " + loggedInUser.getUsername() + " challenger : " + challenger.getUsername() , HttpStatus.UNAUTHORIZED);
        }

        String title = challenger.getFirstName() + " is challenging you.";
        String body = challenge.getMessage();

        return userService.pushNotificationForUser(challengee.getUsername(),title,body,null);
    }
/*
    @RequestMapping(value = "/user/{userId}/games", method = RequestMethod.GET)
    public List<Game> userMacths(@PathVariable(value="userId") Long userId) {
        return repoGames.findByUser(userService.findOne(userId));
    }*/

    @RequestMapping(value = "/user/{userName}/games", method = RequestMethod.GET)
    public List<GameDTO> userGamesForTournament(@PathVariable(value="userName") String username,
                                                @RequestParam(value="tournamentName", required = false) String tournamentName,
                                                @RequestParam("page") Optional<Integer> page,
                                                @RequestParam("page_size") Optional<Integer> pageSize) {
        List<GameDTO> m = new ArrayList<>();

        Pageable pageable = null;
        if(page.isPresent() && pageSize.isPresent()){
            pageable = new PageRequest(page.get(),pageSize.get());
        }

        if(tournamentName != null){
            m = gameService.findByUserByTournament(username,tournamentName, pageable);
        }else
            m = gameService.findByUsername(username, pageable);

        return m;
    }


    @RequestMapping(value = "/push/all", method = RequestMethod.POST)
    public ResponseEntity pushAll(@RequestBody Map message ) {

        if(userService.whoIsLoggedIn().getUserId() != 1){
            throw new APIException(UserController.class,"",HttpStatus.UNAUTHORIZED);
        }

        userService.pushAll((String) message.get("title"), (String) message.get("message"));

        return new ResponseEntity(HttpStatus.OK);
    }
}
